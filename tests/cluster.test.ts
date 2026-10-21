import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';
import { portableHtml } from '../scripts/build-web.ts';
import { CLUSTER_LEVELS, clusterLevels, clusterSkills, skillWords, stem } from '../src/core/cluster.ts';
import { openGitHub } from '../src/core/github.ts';
import { replay, type Recording } from '../src/core/replay.ts';
import { scanTarget } from '../src/core/target.ts';
import { scanWithContents, withClusters } from '../src/core/view.ts';
import { createWebServer } from '../src/server.ts';
import { ORG, organizationFixture } from './organization-fixture.ts';

const skill = (name: string, description = '') => ({ id: `repo:${name}`, name, description });
const ids = (...names: string[]) => names.map((name) => `repo:${name}`);
const names = (clusters: { skills: string[] }[]) => clusters.map((cluster) => cluster.skills.map((id) => id.slice('repo:'.length)));

test('terms: lowercase stems split at punctuation, without short, numeric, or stop words', () => {
  assert.deepEqual(['tests', 'testing', 'tested', 'mapped', 'libraries', 'classes', 'fixes', 'process', 'status', 'analysis', 'string'].map(stem),
    ['test', 'test', 'test', 'map', 'library', 'class', 'fix', 'process', 'status', 'analysis', 'string']);
  assert.deepEqual([...skillWords(skill('code-review', 'Use this skill to review Pull_Requests and 2024 diffs; process v1.0 of the agent.'))],
    ['code', 'review', 'pull', 'request', 'diff', 'process']);
  assert.deepEqual([...skillWords(skill('Ünïcode-Tests', undefined as unknown as string))], ['ünïcode', 'test']);
});

const kotlin = [
  skill('kotlin-format', 'Formats Kotlin sources with ktlint in this repository.'),
  skill('kotlin-lint', 'Lints Kotlin sources with ktlint rules in this repository.'),
];
const release = [
  skill('release-notes', 'Writes release notes and the changelog for this repository.'),
  skill('changelog', 'Updates the changelog with release notes in this repository.'),
];
const noise = [
  skill('triage', 'Labels new issues in this repository.'),
  skill('docs', 'Publishes the documentation site from this repository.'),
];

test('skills cluster by distinctive shared terms; a term every skill uses does not link', () => {
  const { clusters, unclustered } = clusterSkills([...kotlin, ...release, ...noise], { threshold: 0.08 });
  assert.deepEqual(names(clusters), [['release-notes', 'changelog'], ['kotlin-format', 'kotlin-lint']], 'Equal sizes: by label');
  assert.deepEqual(clusters.map((cluster) => cluster.words), [['changelog', 'notes', 'release', 'repository'], ['kotlin', 'ktlint', 'sources', 'repository']]);
  assert.deepEqual(unclustered, ids('triage', 'docs'), '"repository" alone, in every skill, links nothing');
  assert.deepEqual(clusterSkills([skill('a', 'Shared words here.'), skill('b', 'Shared words here.')]).clusters,
    [{ words: ['shared', 'words'], skills: ids('a', 'b') }], 'Two skills alone still cluster');
  assert.deepEqual(clusterSkills([]), { clusters: [], unclustered: [] });
});

test('average linkage: a bridging skill similar to two topics does not chain them together', () => {
  const bridge = skill('bridge', 'Kotlin ktlint changelog release.');
  const loose = { threshold: 0.08 };
  assert.deepEqual(names(clusterSkills([...kotlin, bridge, ...noise], loose).clusters), [['kotlin-format', 'kotlin-lint', 'bridge']]);
  assert.deepEqual(names(clusterSkills([...release, bridge, ...noise], loose).clusters), [['release-notes', 'changelog', 'bridge']]);
  assert.deepEqual(names(clusterSkills([...kotlin, ...release, bridge, ...noise], loose).clusters),
    [['release-notes', 'changelog', 'bridge'], ['kotlin-format', 'kotlin-lint']]);
});

test('levels share one run of merges: stricter levels split looser clusters, never join them', () => {
  const skills = [...kotlin, ...release, skill('kotlin-release', 'Formats Kotlin sources, lints with ktlint, writes release notes and the changelog for this repository.'), ...noise];
  const levels = clusterLevels(skills);
  assert.deepEqual(levels.map(({ name, threshold }) => ({ name, threshold })), CLUSTER_LEVELS.map(({ name, threshold }) => ({ name, threshold })));
  assert.deepEqual(levels.map((level) => names(level.clusters)), [
    [['kotlin-format', 'kotlin-lint', 'release-notes', 'changelog', 'kotlin-release']],
    [['kotlin-format', 'kotlin-lint', 'release-notes', 'changelog', 'kotlin-release']],
    [['release-notes', 'changelog', 'kotlin-release'], ['kotlin-format', 'kotlin-lint']],
  ]);
  for (const [strict, loose] of [[levels[2], levels[1]], [levels[1], levels[0]]]) {
    for (const cluster of strict.clusters) assert.ok(loose.clusters.some((other) => cluster.skills.every((id) => other.skills.includes(id))));
  }
  assert.deepEqual(clusterSkills(skills, { threshold: 0.2 }), { clusters: levels[2].clusters, unclustered: levels[2].unclustered });
});

test('an organization clusters skills across repositories, ignoring copies and test data', async () => {
  const github = { fetch: replay(organizationFixture()) };
  const result = withClusters(await scanTarget(ORG, (url) => openGitHub(url, github), github, scanWithContents));
  assert.deepEqual(result.clusterings.map((level) => level.name), ['Loose', 'Balanced', 'Strict']);
  for (const level of result.clusterings) {
    assert.deepEqual(level.clusters.map((cluster) => cluster.skills), [
      ['Example/alpha:docs/elsewhere/SKILL.md', 'Example/zebra:docs/elsewhere/SKILL.md'],
      ['Example/alpha:.agents/skills/shared/SKILL.md', 'Example/zebra:.agents/skills/shared/SKILL.md'],
    ]);
    assert.deepEqual(level.unclustered, []);
  }
});

const commit = 'c1u5t3r';
const files = new Map([
  ['.claude/skills/code-review/SKILL.md', 'Reviews code changes in pull requests.'],
  ['.claude/skills/review-bot/SKILL.md', 'Leaves review comments on pull requests.'],
  ['skills/lint/SKILL.md', 'Formats kotlin sources.'],
  ['skills/kotlin-style/SKILL.md', 'Kotlin formats <b>bold</b> sources.'],
  ['skills/lonely/SKILL.md', 'Nothing in common.'],
  ['skills/pull-stats/SKILL.md', 'Counts pull requests per week.'],
  ['tests/data/code-review-copy/SKILL.md', 'Reviews code changes in pull requests.'],
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
      words: card.querySelector('h5')!.firstChild!.textContent!.trim(),
      size: card.querySelector('.cluster-size')!.textContent,
      skills: [...card.querySelectorAll('button')].map((button) => button.textContent),
    }));
    assert.equal(element('#clusters').hidden, false);
    assert.equal(element('#clusters-title').textContent, 'Skill clusters');
    const level = document.querySelector<HTMLSelectElement>('#cluster-level')!;
    assert.equal(document.querySelector('label[for="cluster-level"]')!.textContent, 'Cluster similarity');
    assert.deepEqual([...level.options].map((option) => option.textContent), ['Loose · 2 clusters', 'Balanced · 2 clusters', 'Strict · 2 clusters']);
    assert.equal(level.value, 'Loose', 'Under 50 skills, start loose');
    assert.deepEqual(cards(), [
      { words: 'review · pull · requests', size: '3 skills', skills: ['code-review', 'pull-stats', 'review-bot'] },
      { words: 'kotlin · formats · sources', size: '2 skills', skills: ['kotlin-style', 'lint'] },
    ]);
    assert.equal(element('#cluster-count').textContent, '2 clusters');
    assert.equal(element('#unclustered').textContent, 'Not in a cluster: 1 skill');
    assert.equal(element('#no-clusters').hidden, true);
    assert.equal(document.querySelector('#cluster-list b'), null, 'Descriptions never become markup');
    const initialRequests = [...requests];
    level.value = 'Balanced';
    level.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.deepEqual(cards(), [
      { words: 'kotlin · formats · sources', size: '2 skills', skills: ['kotlin-style', 'lint'] },
      { words: 'review · pull · requests', size: '2 skills', skills: ['code-review', 'review-bot'] },
    ]);
    assert.equal(element('#unclustered').textContent, 'Not in a cluster: 2 skills');
    level.value = 'Loose';
    level.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

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
    assert.deepEqual(cards(), [{ words: 'review · pull · requests', size: '1 skill', skills: ['review-bot'] }]);
    assert.equal(element('#cluster-count').textContent, '1 cluster');
    assert.equal(element('#unclustered').textContent, '');
    filterBy('nothing');
    assert.deepEqual(cards(), []);
    assert.equal(element('#no-clusters').hidden, false);
    assert.equal(element('#no-clusters').textContent, 'No skills share enough words to form a cluster.');
    assert.equal(element('#unclustered').textContent, 'Not in a cluster: 1 skill');
    filterBy('not-found');
    assert.equal(element('#clusters').hidden, true);
    filterBy('');
    assert.equal(cards().length, 2);
    assert.deepEqual(requests, initialRequests, 'Clusters are computed once per scan');
    form.dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
    assert.equal(level.options.length, 0, 'A new scan resets the levels');
    while (form.hasAttribute('aria-busy')) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(level.value, 'Loose');
    assert.deepEqual(errors, []);
  });
}
