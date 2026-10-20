import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/commands.ts';
import { discoverOrganization, openGitHub, parseGitHubUrl, type GitHubOptions } from '../src/core/github.ts';
import { replay, type Recording } from '../src/core/replay.ts';
import { scanTarget, type OrganizationResult } from '../src/core/target.ts';
import { openDirectory } from '../src/local.ts';
import { CLI } from './helpers.ts';
import { API, ORG, LIST, entry, organizationFixture } from './organization-fixture.ts';

async function command(recording: Recording, input = ORG, token?: string) {
  const requests: { url: string; authorization?: string }[] = [];
  const transport = replay(recording);
  const github: GitHubOptions = { token, fetch: async (url, init) => {
    requests.push({ url, authorization: init?.headers?.Authorization });
    return transport(url, init);
  } };
  const stdout: string[] = [], stderr: string[] = [];
  const code = await run(['scan', input], { github,
    open: (url) => parseGitHubUrl(url) ? openGitHub(url, github) : openDirectory(url),
    print: (line) => stdout.push(line), error: (line) => stderr.push(line),
  });
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n'), requests };
}

test('organization CLI paginates public repositories, includes forks/archives, isolates copies and test data, and retains partial results', async () => {
  for (const token of [undefined, 'test-token']) {
    const result = await command(organizationFixture(), ORG, token);
    assert.equal(result.code, 1);
    assert.match(result.stdout, /^Example · 4 skills · PARTIAL RESULTS/);
    assert.match(result.stdout, /4 discovered, 2 successfully scanned, 1 failed, 1 skipped/);
    assert.ok(result.stdout.indexOf('Example/alpha ·') < result.stdout.indexOf('Example/zebra ·'));
    assert.equal(result.stdout.match(/^same-name — /gm)?.length, 2);
    assert.equal(result.stdout.match(/^In agents' folders · 1 skill/gm)?.length, 2);
    assert.equal(result.stdout.match(/^Elsewhere · 1 skill/gm)?.length, 2);
    assert.equal(result.stdout.match(/also in .claude\/skills\/shared\/SKILL.md/g)?.length, 2);
    assert.equal(result.stdout.match(/Test data, not skills · 1 file/g)?.length, 2);
    assert.match(result.stdout, /Example\/alpha\/blob\/alpha-commit\/.agents\/skills\/shared\/SKILL.md/);
    assert.match(result.stdout, /Example\/zebra\/blob\/zebra-commit\/tests\/fixtures\/broken\/SKILL.md/);
    assert.match(result.stderr, /Example\/empty: Repository is empty; skipped/);
    assert.match(result.stderr, /Example\/failed: Repository not found/);
    assert.ok(result.requests.some(({ url }) => url.endsWith('&page=2')));
    assert.ok(!result.requests.some(({ url }) => url.includes('/private') || url.includes('/search/code')));
    assert.ok(!result.requests.some(({ url }) => url.startsWith('https://raw.') && /fixtures|claude/.test(url)));
    assert.ok(result.requests.filter(({ url }) => url.startsWith(API)).every(({ authorization }) => authorization === (token ? `Bearer ${token}` : undefined)));
    assert.ok(result.requests.filter(({ url }) => url.startsWith('https://raw.')).every(({ authorization }) => !authorization));
  }
});

test('organization scan preserves distinct IDs and skill order across repositories', async () => {
  const github = { fetch: replay(organizationFixture()) };
  const result = await scanTarget(ORG, (url) => openGitHub(url, github), github) as OrganizationResult;
  assert.deepEqual(result.repositories.map((r) => r.repository.id), ['Example/alpha', 'Example/zebra']);
  assert.deepEqual(result.repositories[0].skills.map((s) => s.name), ['aaa-elsewhere', 'same-name']);
  assert.equal(new Set(result.skills.map((s) => s.id)).size, 4);
});

test('organization no-public-repository and no-skill states succeed; all-empty scans are explicitly partial', async () => {
  for (const mode of ['no-repositories', 'no-skills', 'empty']) {
    const fixture = organizationFixture();
    fixture[LIST] = { status: 200, body: mode === 'no-repositories' ? [] : [entry(mode === 'empty' ? 'empty' : 'alpha')] };
    if (mode === 'no-skills') fixture[`${API}/repos/Example/alpha/git/trees/alpha-commit?recursive=1`] = { status: 200, body: { truncated: false, tree: [] } };
    const result = await command(fixture);
    assert.equal(result.code, mode === 'empty' ? 1 : 0);
    assert.match(result.stdout, mode === 'no-repositories' ? /No public repositories found/ : mode === 'empty' ? /No skills found in the completed scans/ : /No skills found/);
    assert.match(result.stdout, /Example · 0 skills/);
  }
});

test('invalid, user, and nonexistent organization targets fail without listing user repositories', async () => {
  const fixture = organizationFixture();
  fixture[`${API}/users/Example`] = { status: 200, body: { login: 'Example', type: 'User' } };
  const user = await command(fixture);
  assert.equal(user.code, 1);
  assert.match(user.stderr, /requires an organization; Example is a user account/);
  assert.equal(user.requests.length, 1);
  fixture[`${API}/users/Example`] = { status: 404, body: { message: 'Not Found' } };
  const missing = await command(fixture);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /Organization not found/);
  assert.equal(missing.stdout, '');
  const invalid = await command({}, 'https://github.com/Example/repo/extra');
  assert.equal(invalid.code, 1);
  assert.equal(invalid.requests.length, 0);
});

test('organization discovery failure on a later page is an error, never an empty successful scan', async () => {
  const fixture = organizationFixture();
  fixture[LIST.replace('&page=1', '&page=2')] = { status: 403, body: { message: 'API rate limit exceeded' } };
  const result = await command(fixture);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /rate limit reached; set GITHUB_TOKEN/);
  assert.equal(result.stdout, '');
});

test('organization rate limits during discovery and individual scans keep environment guidance and do not leak tokens', async () => {
  for (const status of [403, 429]) {
    for (const token of [undefined, 'secret-test-token']) {
      for (const phase of ['discovery', 'repository', 'document']) {
        const fixture = organizationFixture();
        fixture[LIST] = { status: 200, body: [entry('alpha'), entry('zebra')] };
        const url = phase === 'discovery' ? `${API}/users/Example` : phase === 'document'
          ? 'https://raw.githubusercontent.com/Example/zebra/zebra-commit/.agents/skills/shared/SKILL.md'
          : `${API}/repos/Example/zebra`;
        fixture[url] = { status, body: { message: `API rate limit exceeded ${token}` }, headers: { 'x-ratelimit-remaining': '0' } };
        const result = await command(fixture, ORG, token);
        assert.equal(result.code, 1);
        assert.match(result.stderr, /GitHub rate limit reached/);
        if (phase === 'discovery') assert.equal(result.stdout, '');
        else {
          assert.match(result.stdout, /PARTIAL RESULTS/);
          assert.match(result.stdout, /Example\/alpha · 2 skills/);
          assert.match(result.stderr, /Example\/zebra:/);
        }
        assert.doesNotMatch(result.stderr + result.stdout, /secret-test-token/);
      }
    }
  }
});

test('CLI executable dispatches an organization URL to the GitHub API', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-org-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const preload = join(dir, 'mock.mjs');
  await writeFile(preload, `globalThis.fetch = async (url) => {\nconst data = ${JSON.stringify({
    [`${API}/users/Example`]: { login: 'Example', type: 'Organization' }, [LIST]: [],
  })};\nif (!Object.hasOwn(data, url)) throw new Error('Unexpected URL');\nreturn new Response(JSON.stringify(data[url]));\n};`);
  const result = spawnSync(process.execPath, ['--import', preload, CLI, 'scan', ORG], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Example · 0 skills/);
  assert.match(result.stdout, /No public repositories found/);
});

test('organization discovery handles a full page without Link headers, deduplicates, and sorts case insensitively', async () => {
  const fixture = organizationFixture();
  fixture[LIST] = { status: 200, body: Array.from({ length: 100 }, () => entry('zebra')) };
  fixture[LIST.replace('&page=1', '&page=2')] = { status: 200, body: [entry('Beta'), entry('alpha'), entry('zebra')] };
  const result = await discoverOrganization('github.com/Example/', { fetch: replay(fixture) });
  assert.deepEqual(result.repositories, ['https://github.com/Example/alpha', 'https://github.com/Example/Beta', 'https://github.com/Example/zebra']);
});

test('organization warnings distinguish malformed documents from incomplete discovery and missing files', async () => {
  for (const mode of ['malformed', 'missing-file', 'truncated', 'no-default-branch']) {
    const fixture = organizationFixture();
    fixture[LIST] = { status: 200, body: [entry('alpha')] };
    const treeUrl = `${API}/repos/Example/alpha/git/trees/alpha-commit?recursive=1`;
    const rawUrl = 'https://raw.githubusercontent.com/Example/alpha/alpha-commit/.agents/skills/shared/SKILL.md';
    if (mode === 'malformed') fixture[rawUrl] = { status: 200, body: '---\nname: [invalid\n---\n# Malformed' };
    if (mode === 'missing-file') fixture[rawUrl] = { status: 404, body: 'Not Found' };
    if (mode === 'no-default-branch') fixture[`${API}/repos/Example/alpha`] = { status: 200, body: { full_name: 'Example/alpha', default_branch: null } };
    if (mode === 'truncated') {
      fixture[treeUrl].body = { ...(fixture[treeUrl].body as object), truncated: true };
      fixture[`${API}/repos/Example/alpha/git/trees/alpha-commit`] = { status: 200, body: { truncated: false, tree: [] } };
    }
    const result = await command(fixture);
    assert.equal(result.code, mode === 'malformed' ? 0 : 1);
    assert.match(result.stderr, /warning: Example\/alpha:/);
    assert.match(result.stderr, mode === 'malformed' ? /malformed front matter/ : mode === 'missing-file' ? /listed, but not found/ : mode === 'truncated' ? /tree is too large/ : /Repository is empty; skipped/);
    if (mode === 'no-default-branch') assert.match(result.stdout, /0 successfully scanned, 0 failed, 1 skipped/);
    else assert.match(result.stdout, /1 successfully scanned, 0 failed, 0 skipped/);
  }
});

test('GitHub errors redact an echoed token during organization discovery and repository scanning', async () => {
  const token = 'sensitive-test-token';
  for (const phase of ['discovery', 'repository']) {
    const fixture = organizationFixture();
    const url = phase === 'discovery' ? `${API}/users/Example` : `${API}/repos/Example/zebra`;
    fixture[url] = { status: 500, body: { message: `Upstream error includes ${token}` } };
    const result = await command(fixture, ORG, token);
    assert.equal(result.code, 1);
    assert.doesNotMatch(result.stderr, /sensitive-test-token/);
    assert.match(result.stderr, /\[redacted\]/);
  }
});

test('organization responses interrupted after their headers fail only that repository, or discovery as a whole', async () => {
  const interrupted = () => new Response(new ReadableStream({ start(controller) { controller.error(new TypeError('terminated')); } }));
  for (const phase of ['document', 'repository', 'discovery']) {
    const url = phase === 'discovery' ? LIST : phase === 'document'
      ? 'https://raw.githubusercontent.com/Example/zebra/zebra-commit/.agents/skills/shared/SKILL.md'
      : `${API}/repos/Example/zebra/git/trees/zebra-commit?recursive=1`;
    const fixture = organizationFixture();
    fixture[LIST] = { status: 200, body: [entry('alpha'), entry('zebra')] };
    const transport = replay(fixture);
    const stdout: string[] = [], stderr: string[] = [];
    const github: GitHubOptions = { fetch: async (requested, init) => requested === url ? interrupted() : transport(requested, init) };
    const code = await run(['scan', ORG], { github, open: (input) => openGitHub(input, github),
      print: (line) => stdout.push(line), error: (line) => stderr.push(line) });
    assert.equal(code, 1, phase);
    assert.match(stderr.join('\n'), /Cannot read GitHub's answer for .*: terminated/, phase);
    if (phase === 'discovery') assert.equal(stdout.join('\n'), '', phase);
    else {
      assert.match(stdout.join('\n'), /^Example · 2 skills · PARTIAL RESULTS/, phase);
      assert.match(stdout.join('\n'), /2 discovered, 1 successfully scanned, 1 failed, 0 skipped/, phase);
      assert.match(stdout.join('\n'), /Example\/alpha · 2 skills/, phase);
      assert.match(stderr.join('\n'), /Example\/zebra: Cannot read GitHub's answer/, phase);
    }
  }
});
