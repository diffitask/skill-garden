import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';
import { portableHtml } from '../scripts/build-web.ts';
import { run } from '../src/commands.ts';
import { openGitHub } from '../src/core/github.ts';
import { replay, type Recording } from '../src/core/replay.ts';
import { createWebServer } from '../src/server.ts';
import { CLI } from './helpers.ts';

const repository = 'https://github.com/owner/filtering';
const commit = 'abc123456789';
const body = '\n# bodyneedle\n<script>window.unsafe = true</script>\n';
const documentFor = (name: string, description?: string) => `---\nname: ${name}\n${description === undefined ? '' : `description: ${JSON.stringify(description)}\n`}---\n${body}`;
const files = new Map([
  ['.agents/skills/code-review/SKILL.md', documentFor('code-review', 'Reviews patches.\nHandles C++ [draft] v1.0 a+b.')],
  ['.claude/skills/code-review/SKILL.md', documentFor('copyneedle', 'A copy that must not be read.')],
  ['skills/reviewer/SKILL.md', documentFor('reviewer', 'Checks changes. Reviews CODE and deepneedle.')],
  ['skills/code/SKILL.md', documentFor('code', 'Formats sources.')],
  ['skills/pathneedle/missing/SKILL.md', documentFor('missing')],
  ['skills/broken/SKILL.md', '---\nname: [broken\n---\n' + body],
  ['skills/zebra/SKILL.md', documentFor('zebra', 'Packages archives. Uses deepneedle for releases.')],
  ['tests/data/testneedle/SKILL.md', documentFor('testneedle', 'CODE review')],
]);
const allNames = ['broken', 'code', 'code-review', 'missing', 'reviewer', 'zebra'];
const cases: [string, string[]][] = [
  ['code-review', ['code-review']],
  ['review', ['code-review', 'reviewer']],
  ['CODE review', ['code-review', 'reviewer']],
  ['deepneedle', ['reviewer', 'zebra']],
  ['\t CoDe \n REVIEW  ', ['code-review', 'reviewer']],
  ['C++', ['code-review']],
  ['[draft]', ['code-review']],
  ['[', ['code-review']],
  ['a+b', ['code-review']],
  ['C++ [draft]', ['code-review']],
  ['v1.0', ['code-review']],
  ['.*', []],
  ['missing', ['missing']],
  ['broken', ['broken']],
  ['pathneedle', []],
  ['bodyneedle', []],
  ['testneedle', []],
  ['copyneedle', []],
  ['not-found', []],
  ['code-review Reviews', ['code-review']],
  ['code-reviewReviews', []],
  ['', allNames],
  [' \t\n ', allNames],
];

function recordedGitHub(requests: string[]) {
  const recording: Recording = {
    'https://api.github.com/repos/owner/filtering': { status: 200, body: { full_name: 'owner/filtering', default_branch: 'main' } },
    'https://api.github.com/repos/owner/filtering/commits/main': { status: 200, body: { sha: commit } },
    [`https://api.github.com/repos/owner/filtering/git/trees/${commit}?recursive=1`]: { status: 200, body: {
      truncated: false, tree: [...files.keys()].map((path) => ({ path, type: 'blob', mode: '100644', sha: 'file' })),
    } },
  };
  for (const [path, content] of files) {
    recording[`https://raw.githubusercontent.com/owner/filtering/${commit}/${path}`] = { status: 200, body: content };
  }
  const github = replay(recording);
  return async (input: string, init?: { headers?: Record<string, string> }) => {
    requests.push(input);
    return github(input, init);
  };
}

function assertCliOutput(output: string, names: string[], query: string, id: string) {
  assert.equal(output.split('\n')[0], `${id} · ${names.length} ${names.length === 1 ? 'skill' : 'skills'}`, query);
  // Grouping puts the agent skill first, then the remaining skills in sorted order.
  const printedNames = output.split('\n').filter((line) => allNames.includes(line.split(' — ')[0])).map((line) => line.split(' — ')[0]);
  assert.deepEqual(printedNames, [...names.filter((name) => name === 'code-review'), ...names.filter((name) => name !== 'code-review')], query);
  assert.equal(output.includes("In agents' folders · 1 skill"), names.includes('code-review'), query);
  const elsewhere = names.filter((name) => name !== 'code-review').length;
  assert.equal(output.includes(`Elsewhere · ${elsewhere} ${elsewhere === 1 ? 'skill' : 'skills'}`), elsewhere > 0, query);
  assert.equal(output.includes('No skills match your filter'), names.length === 0, query);
  assert.match(output, /Test data, not skills · 1 file\n.*tests\/data\/testneedle\/SKILL.md/);
  assert.equal(output.includes('also in .claude/skills/code-review/SKILL.md'), names.includes('code-review'));
}

test('CLI filters local and GitHub scans by literal words without changing scan metadata', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'skill-atlas-filter-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [path, content] of files) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  const baseline = spawnSync(process.execPath, [CLI, 'scan', root], { encoding: 'utf8' });
  assert.equal(baseline.status, 0, baseline.stderr);
  for (const [query, names] of cases) {
    const local = spawnSync(process.execPath, [CLI, 'scan', root, '--filter', query], { encoding: 'utf8' });
    assert.equal(local.status, 0, local.stderr);
    assertCliOutput(local.stdout.trimEnd(), names, query, root.split('/').at(-1)!);
    assert.equal(local.stderr, baseline.stderr, 'Warnings are unchanged, even when no skills match');
    if (!query.trim()) assert.equal(local.stdout, baseline.stdout);

    const requests: string[] = [];
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await run(['scan', repository, '--filter', query], {
      open: (input) => openGitHub(input, { fetch: recordedGitHub(requests) }),
      print: (line) => stdout.push(line), error: (line) => stderr.push(line),
    });
    assert.equal(code, 0, stderr.join('\n'));
    assertCliOutput(stdout.join('\n'), names, query, 'owner/filtering');
    assert.equal(stderr.length, 1);
    assert.match(stderr[0], /skills\/broken\/SKILL.md: malformed front matter/);
    assert.equal(requests.length, 9, 'Read all six primary skills, never copies or test data');
    assert.ok(stdout.filter((line) => line.startsWith('  https://')).every((line) => line.includes(`/blob/${commit}/`)));
  }
});

test('CLI rejects malformed filter options before opening the repository', async () => {
  for (const args of [[], ['repo', '--filter'], ['repo', '--unknown', 'words'], ['repo', '--filter', 'words', 'extra']]) {
    const errors: string[] = [];
    const code = await run(['scan', ...args], {
      open: async () => { throw new Error('Invalid arguments must not scan'); },
      print: () => assert.fail('Invalid arguments must not print results'), error: (line) => errors.push(line),
    });
    assert.equal(code, 1);
    assert.match(errors[0], /^Usage: skill-atlas scan.*--filter/);
  }
});

for (const variant of ['local', 'portable'] as const) {
  test(`${variant} web filters current results immediately and preserves selection, links, warnings, and keyboard access`, async (t) => {
    const requests: string[] = [];
    const github = recordedGitHub(requests);
    const errors: Error[] = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', (error) => errors.push(error));
    let dom: JSDOM;
    if (variant === 'local') {
      const server = createWebServer({ open: (input) => openGitHub(input, { fetch: github }) });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      t.after(() => server.close());
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      dom = await JSDOM.fromURL(base, {
        runScripts: 'dangerously', resources: 'usable', virtualConsole,
        beforeParse(window) {
          window.fetch = (input, init) => {
            requests.push(String(input));
            return fetch(new URL(String(input), base), init);
          };
        },
      });
      await new Promise((resolve) => dom.window.addEventListener('load', resolve, { once: true }));
    } else {
      dom = new JSDOM(await portableHtml(), {
        url: 'file:///skill-garden.html', runScripts: 'dangerously', virtualConsole,
        beforeParse(window) {
          Object.assign(window, { TextDecoder, TextEncoder });
          window.fetch = (input, init) => github(String(input), init as { headers?: Record<string, string> });
        },
      });
    }
    t.after(() => dom.window.close());
    const document = dom.window.document;
    const element = (id: string) => document.querySelector<HTMLElement>(id)!;
    const form = document.querySelector('form')!;
    document.querySelector<HTMLInputElement>('#repository')!.value = repository;
    const submit = async () => {
      form.dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
      const deadline = Date.now() + 5000;
      while (form.hasAttribute('aria-busy')) {
        if (Date.now() > deadline) throw new Error('Filter scan did not finish');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(element('#scan-error').hidden, true, element('#error-message').textContent!);
    };
    await submit();
    const filter = document.querySelector<HTMLInputElement>('#filter-skills')!;
    assert.equal(document.querySelector('label[for="filter-skills"]')!.textContent, 'Filter skills');
    assert.equal(filter.getAttribute('aria-controls'), 'skills');
    const filterBy = (query: string) => {
      filter.focus();
      filter.value = query;
      filter.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      assert.equal(document.activeElement, filter, 'Typing keeps focus in the filter');
    };
    const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('#skills button')];
    const names = () => buttons().map((button) => button.querySelector('strong')!.textContent);
    const full = document.querySelector<HTMLDetailsElement>('#full-document')!;
    const warnings = element('#warnings').textContent;
    const initialRequests = [...requests];
    assert.deepEqual(names(), allNames);
    for (const [query, expected] of cases) {
      filterBy(query);
      assert.deepEqual(names(), expected, query);
      assert.equal(element('#count').textContent, `${expected.length} of 6 skills`, query);
      assert.equal(element('#no-matches').hidden, expected.length !== 0, query);
      assert.equal(element('#results').hidden, false, 'The filter remains available with zero matches');
      if (expected.length === 0) {
        assert.equal(element('#no-matches').textContent, 'No skills match your filter');
        assert.equal(element('#detail').hidden, true);
        for (const id of ['#skill-name', '#description', '#path', '#content']) assert.equal(element(id).textContent, '');
        assert.equal(element('#source').hasAttribute('href'), false);
        assert.equal(full.open, false);
      } else {
        assert.equal(element('#detail').hidden, false);
        const selected = buttons().filter((button) => button.hasAttribute('aria-current'));
        assert.equal(selected.length, 1);
        assert.equal(element('#skill-name').textContent, selected[0].querySelector('strong')!.textContent);
        assert.ok(expected.includes(element('#skill-name').textContent!));
        assert.match(element('#source').getAttribute('href')!, new RegExp(`/blob/${commit}/`));
        if (query === 'missing' || query === 'broken') assert.match(element('#description').textContent!, /No description provided/);
      }
      assert.equal(element('#warnings').textContent, warnings);
      assert.equal(element('#warnings').hidden, false);
      assert.deepEqual(requests, initialRequests, 'Filtering performs no network requests or file reads');
    }
    filterBy('');
    buttons().find((button) => button.querySelector('strong')!.textContent === 'reviewer')!.click();
    full.open = true;
    const selectedContent = element('#content').textContent;
    const selectedLink = element('#source').getAttribute('href');
    filterBy('CODE review');
    assert.equal(element('#skill-name').textContent, 'reviewer', 'Keep selection when still matching');
    assert.equal(full.open, true);
    assert.equal(element('#content').textContent, selectedContent);
    assert.equal(element('#source').getAttribute('href'), selectedLink);
    filterBy('C++');
    assert.equal(element('#skill-name').textContent, 'code-review', 'Select first match if previous selection is removed');
    assert.equal(full.open, false);
    filterBy('deepneedle');
    assert.equal(element('#skill-name').textContent, 'reviewer', 'Fallback chooses the first of multiple matches');
    filterBy('');
    assert.equal(element('#skill-name').textContent, 'reviewer', 'Clearing retains a selection that still matches');
    filterBy('not-found');
    filterBy('');
    assert.deepEqual(names(), allNames);
    assert.equal(element('#skill-name').textContent, 'broken');
    filterBy('review');
    buttons()[0].focus();
    for (const [key, expected] of [['ArrowDown', 'reviewer'], ['Home', 'code-review'], ['End', 'reviewer'], ['ArrowUp', 'code-review']]) {
      document.activeElement!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      assert.equal(element('#skill-name').textContent, expected);
      assert.equal(document.activeElement!.querySelector('strong')!.textContent, expected);
    }
    buttons()[1].click(); // Native buttons retain their Tab and Enter activation behavior.
    assert.equal(element('#skill-name').textContent, 'reviewer');
    assert.ok(buttons().every((button) => button.type === 'button' && button.tabIndex === 0));
    assert.deepEqual(requests, initialRequests);
    filterBy('not-found');
    await submit();
    assert.equal(filter.value, '', 'A new scan resets the filter');
    assert.deepEqual(names(), allNames);
    assert.equal(element('#skill-name').textContent, 'broken');
    assert.deepEqual(errors, []);
  });
}
