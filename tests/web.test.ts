import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';
import type { Skill } from '../src/core/model.ts';
import { AtlasError } from '../src/core/errors.ts';
import type { Source } from '../src/core/scan.ts';
import { createWebServer } from '../src/server.ts';

const malicious = '<script>window.repositoryScriptRan = true</script>';
const files = new Map([
  ['skills/zebra/SKILL.md', '---\nname: zebra\ndescription: Last skill.\n---\n# Zebra\n'],
  ['skills/alpha/SKILL.md', `---\nname: alpha\ndescription: First skill.\n---\n# Alpha\n${malicious}\n`],
  ['skills/broken/SKILL.md', '---\nname: [broken\n---\n# Broken\n'],
]);

async function start() {
  const reads: string[] = [];
  const server = createWebServer({ open: async (input): Promise<Source> => {
    const name = input.split('/').at(-1)!;
    if (name === 'missing') throw new AtlasError('Repository not found');
    if (name === 'limited') throw new AtlasError('GitHub rate limit reached; set GITHUB_TOKEN');
    if (name === 'slow') await new Promise((resolve) => setTimeout(resolve, 250));
    return {
      repository: { id: `owner/${name}`, organization: 'owner', name, url: `https://github.com/owner/${name}`, commit: 'abc123456789' },
      warnings: [], paths: name === 'empty' ? [] : [...files.keys()],
      read: async (path) => { reads.push(path); return new TextEncoder().encode(files.get(path)!); },
    };
  } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, reads, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

test('local HTTP view serves assets, validates input, and returns sorted skills with original contents and pinned links', async (t) => {
  const { server, reads, base } = await start();
  t.after(() => server.close());
  for (const [path, type] of [['/', 'text/html'], ['/app.js', 'text/javascript'], ['/style.css', 'text/css']]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type')?.startsWith(type));
    assert.match(response.headers.get('content-security-policy')!, /default-src 'self'/);
  }
  assert.equal((await fetch(base + '/unknown')).status, 404);
  assert.equal((await fetch(base, { method: 'POST' })).status, 405);
  for (const input of ['', '/etc/passwd', 'https://example.com/owner/repo']) {
    const response = await fetch(`${base}/api/scan?repository=${encodeURIComponent(input)}`);
    assert.equal(response.status, 400);
    assert.match(((await response.json()) as { error: string }).error, /GitHub repository URL/);
  }
  const response = await fetch(`${base}/api/scan?repository=https://github.com/owner/repo`);
  const result = await response.json() as { repository: { id: string }; skills: (Skill & { content: string; link: string })[]; warnings: string[] };
  assert.equal(response.status, 200);
  assert.equal(result.repository.id, 'owner/repo');
  assert.deepEqual(result.skills.map((s: { name: string }) => s.name), ['alpha', 'broken', 'zebra']);
  assert.equal(result.skills[0].content, files.get('skills/alpha/SKILL.md'));
  assert.equal(result.skills[0].link, 'https://github.com/owner/repo/blob/abc123456789/skills/alpha/SKILL.md');
  assert.match(result.warnings[0], /malformed front matter/);
  assert.deepEqual(reads.sort(), [...files.keys()].sort());
  const empty = await (await fetch(`${base}/api/scan?repository=https://github.com/owner/empty`)).json() as { skills: Skill[] };
  assert.deepEqual(empty.skills, []);
  for (const [repo, message] of [['missing', /Repository not found/], ['limited', /rate limit/]] as const) {
    const failure = await fetch(`${base}/api/scan?repository=https://github.com/owner/${repo}`);
    assert.equal(failure.status, 502);
    assert.match(((await failure.json()) as { error: string }).error, message);
  }
});

test('web view integrates submission, loading, selection, safe text, warnings, empty results, errors, and retry', async (t) => {
  const { server, base } = await start();
  t.after(() => server.close());
  const errors: Error[] = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => errors.push(error));
  const dom = await JSDOM.fromURL(base, {
    resources: 'usable', runScripts: 'dangerously', virtualConsole,
    beforeParse(window) {
      window.fetch = (input, init) => fetch(new URL(String(input), base), init);
    },
  });
  t.after(() => dom.window.close());
  await new Promise((resolve) => dom.window.addEventListener('load', resolve, { once: true }));
  const document = dom.window.document;
  const input = document.querySelector<HTMLInputElement>('#repository')!;
  const submit = document.querySelector<HTMLButtonElement>('#scan')!;
  const form = document.querySelector('form')!;
  const element = (id: string) => document.querySelector<HTMLElement>(id)!;
  const scan = async (name: string) => {
    input.value = name.includes('/') ? name : `https://github.com/owner/${name}`;
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    assert.equal(submit.disabled, true);
    const deadline = Date.now() + 5000;
    while (form.hasAttribute('aria-busy')) {
      if (Date.now() > deadline) throw new Error('Scan did not finish');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(submit.disabled, false);
  };
  assert.equal(element('#empty').hidden, false);
  await scan('slow');
  assert.equal(element('#skill-name').textContent, 'alpha');
  assert.equal(element('#content').textContent, files.get('skills/alpha/SKILL.md'));
  assert.equal(document.querySelectorAll('#content script').length, 0);
  assert.match(element('#warnings').textContent!, /malformed front matter/);
  assert.match(element('#source').getAttribute('href')!, /blob\/abc123456789/);
  const buttons = document.querySelectorAll<HTMLButtonElement>('#skills button');
  buttons[2].click();
  assert.equal(element('#skill-name').textContent, 'zebra');
  assert.equal(element('#content').textContent, files.get('skills/zebra/SKILL.md'));
  assert.equal(buttons[0].hasAttribute('aria-current'), false);
  assert.equal(buttons[2].getAttribute('aria-current'), 'true');
  await scan('empty');
  assert.equal(element('#empty-title').textContent, 'No skills found.');
  assert.equal(element('#results').hidden, true);
  await scan('missing');
  assert.match(element('#error-message').textContent!, /Repository not found/);
  assert.equal(element('#scan-error').hidden, false);
  assert.equal(element('#scan-error').getAttribute('role'), 'alert');
  assert.equal(document.activeElement, element('#scan-error'));
  assert.equal(element('#github-access').hidden, true);
  await scan('limited');
  assert.match(element('#error-title').textContent!, /GitHub request limit/);
  assert.match(element('#error-message').textContent!, /restart the server with GITHUB_TOKEN/);
  assert.equal(element('#add-token').hidden, true);
  await scan('https://example.com/owner/repo');
  assert.match(element('#error-message').textContent!, /GitHub repository URL/);
  await scan('repo');
  assert.equal(element('#skill-name').textContent, 'alpha');
  assert.equal(element('#results').hidden, false);
  assert.equal(element('#scan-error').hidden, true);
  assert.deepEqual(errors, []);
});
