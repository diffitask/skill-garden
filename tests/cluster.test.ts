import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';
import { portableHtml } from '../scripts/build-web.ts';
import { clusterSkills, skillWords } from '../src/core/cluster.ts';
import { openGitHub } from '../src/core/github.ts';
import { replay, type Recording } from '../src/core/replay.ts';
import { scanTarget } from '../src/core/target.ts';
import { scanWithContents, withClusters } from '../src/core/view.ts';
import { createWebServer } from '../src/server.ts';
import { ORG, organizationFixture } from './organization-fixture.ts';

const skill = (name: string, description = '') => ({ id: `repo:${name}`, name, description });
const ids = (...names: string[]) => names.map((name) => `repo:${name}`);

test('significant words: lowercase, split at punctuation, no short, numeric, or stop words, plurals folded', () => {
  assert.deepEqual([...skillWords(skill('code-review', 'Use this skill to review Pull_Requests and 2024 diffs; process v1.0 of the agent.'))],
    ['code', 'review', 'pull', 'request', 'diff', 'process']);
  assert.deepEqual([...skillWords(skill('Ünïcode-Tests', undefined as unknown as string))], ['ünïcode', 'test']);
});

test('skills sharing two words are clustered, links chain, and one shared word is not enough', () => {
  const skills = [
    skill('zeta', 'Formats kotlin sources.'),
    skill('code-review', 'Reviews code changes.'),
    skill('lint', 'Formats kotlin code.'),
    skill('review-bot', 'Leaves review comments on code.'),
    skill('release', 'Publishes release notes.'),
    skill('notes', 'Writes release notes for changelogs.'),
    skill('lonely', 'Reviews nothing in common.'),
  ];
  const { clusters, unclustered } = clusterSkills(skills);
  assert.deepEqual(unclustered, ids('lonely'), 'One shared word does not link');
  assert.deepEqual(clusters.map((cluster) => cluster.skills), [ids('code-review', 'review-bot'), ids('zeta', 'lint'), ids('release', 'notes')]);
  assert.deepEqual(clusters.map((cluster) => cluster.words), [['code', 'review'], ['format', 'kotlin'], ['note', 'release']]);
  // A bridging skill chains two clusters into one.
  const chained = clusterSkills([...skills, skill('bridge', 'Kotlin code format review')]).clusters;
  assert.deepEqual(chained[0].skills, ids('zeta', 'code-review', 'lint', 'review-bot', 'bridge'));
  assert.deepEqual(chained[0].words, ['code', 'format', 'kotlin', 'review'], 'Most shared first, then alphabetical');
  assert.deepEqual(clusterSkills(skills, 3).clusters, []);
  assert.deepEqual(clusterSkills([]), { clusters: [], unclustered: [] });
});

test('an organization clusters skills across repositories, ignoring copies and test data', async () => {
  const github = { fetch: replay(organizationFixture()) };
  const result = withClusters(await scanTarget(ORG, (url) => openGitHub(url, github), github, scanWithContents));
  assert.deepEqual(result.clustering, { clusters: [
    { words: ['aaa', 'elsewhere'], skills: ['Example/alpha:docs/elsewhere/SKILL.md', 'Example/zebra:docs/elsewhere/SKILL.md'] },
    { words: ['name', 'same', 'testing'], skills: ['Example/alpha:.agents/skills/shared/SKILL.md', 'Example/zebra:.agents/skills/shared/SKILL.md'] },
  ], unclustered: [] });
});

const commit = 'c1u5t3r';
const files = new Map([
  ['.claude/skills/code-review/SKILL.md', 'Reviews code changes.'],
  ['.claude/skills/review-bot/SKILL.md', 'Leaves review comments on code.'],
  ['skills/lint/SKILL.md', 'Formats kotlin sources.'],
  ['skills/kotlin-style/SKILL.md', 'Kotlin formats <b>bold</b>.'],
  ['skills/lonely/SKILL.md', 'Nothing in common.'],
  ['tests/data/code-review-copy/SKILL.md', 'Reviews code changes.'],
]);

function recordedGitHub(requests: string[]) {
  const recording: Recording = {
    'https://api.github.com/repos/owner/clusters': { status: 200, body: { full_name: 'owner/clusters', default_branch: 'main' } },
    'https://api.github.com/repos/owner/clusters/commits/main': { status: 200, body: { sha: commit } },
    [`https://api.github.com/repos/owner/clusters/git/trees/${commit}?recursive=1`]: { status: 200, body: {
      truncated: false, tree: [...files.keys()].map((path) => ({ path, type: 'blob', mode: '100644', sha: 'file' })),
    } },
  };
  for (const [path, description] of files) {
    const name = path.split('/').at(-2);
    recording[`https://raw.githubusercontent.com/owner/clusters/${commit}/${path}`] = { status: 200, body: `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n# ${name}\n` };
  }
  const github = replay(recording);
  return async (input: string, init?: { headers?: Record<string, string> }) => {
    requests.push(input);
    return github(input, init);
  };
}

for (const variant of ['local', 'portable'] as const) {
  test(`${variant} web shows shared-word clusters, selects their skills, and follows the filter`, async (t) => {
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
        url: 'file:///skill-atlas.html', runScripts: 'dangerously', virtualConsole,
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
    document.querySelector<HTMLInputElement>('#repository')!.value = 'https://github.com/owner/clusters';
    form.dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
    const deadline = Date.now() + 5000;
    while (form.hasAttribute('aria-busy')) {
      if (Date.now() > deadline) throw new Error('Cluster scan did not finish');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(element('#scan-error').hidden, true, element('#error-message').textContent!);
    const cards = () => [...document.querySelectorAll('#cluster-list .cluster')].map((card) => ({
      words: card.querySelector('h4')!.firstChild!.textContent!.trim(),
      size: card.querySelector('.cluster-size')!.textContent,
      skills: [...card.querySelectorAll('button')].map((button) => button.textContent),
    }));
    assert.equal(element('#clusters').hidden, false);
    assert.equal(element('#clusters-title').textContent, 'Skill clusters');
    assert.deepEqual(cards(), [
      { words: 'code · review', size: '2 skills', skills: ['code-review', 'review-bot'] },
      { words: 'format · kotlin', size: '2 skills', skills: ['kotlin-style', 'lint'] },
    ]);
    assert.equal(element('#cluster-count').textContent, '2 clusters');
    assert.equal(element('#unclustered').textContent, 'Not in a cluster: 1 skill');
    assert.equal(element('#no-clusters').hidden, true);
    assert.equal(document.querySelector('#cluster-list b'), null, 'Descriptions never become markup');
    const initialRequests = [...requests];

    const member = [...document.querySelectorAll<HTMLButtonElement>('#cluster-list button')].find((button) => button.textContent === 'lint')!;
    member.click();
    assert.equal(element('#skill-name').textContent, 'lint');
    const current = document.querySelectorAll('#skills button[aria-current]');
    assert.equal(current.length, 1);
    assert.equal(current[0].querySelector('strong')!.textContent, 'lint');
    assert.match(element('#source').getAttribute('href')!, new RegExp(`/blob/${commit}/skills/lint/SKILL.md$`));

    const filter = document.querySelector<HTMLInputElement>('#filter-skills')!;
    const filterBy = (query: string) => {
      filter.value = query;
      filter.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    };
    filterBy('comments');
    assert.deepEqual(cards(), [{ words: 'code · review', size: '1 skill', skills: ['review-bot'] }]);
    assert.equal(element('#cluster-count').textContent, '1 cluster');
    assert.equal(element('#unclustered').textContent, '');
    filterBy('common');
    assert.deepEqual(cards(), []);
    assert.equal(element('#no-clusters').hidden, false);
    assert.equal(element('#no-clusters').textContent, 'No skills share enough words to form a cluster.');
    assert.equal(element('#unclustered').textContent, 'Not in a cluster: 1 skill');
    filterBy('not-found');
    assert.equal(element('#clusters').hidden, true);
    filterBy('');
    assert.equal(cards().length, 2);
    assert.deepEqual(requests, initialRequests, 'Clusters are computed once per scan');
    assert.deepEqual(errors, []);
  });
}
