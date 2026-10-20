// The decisions in spec/analysis.md and spec/cli.md, checked on what the real command prints for
// ./fixture and for a small GitHub repository answered in tests/helpers.ts. The edge cases of
// where skills live are yours to add.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { openGitHub } from '../src/core/github.ts';
import { parseSkill } from '../src/core/parse.ts';
import { replay } from '../src/core/replay.ts';
import { scan } from '../src/core/scan.ts';
import { atlas, CLI, EXAMPLE_COMMIT, FIXTURE } from './helpers.ts';

const fixture = await atlas(['scan', FIXTURE]);
const example = await atlas(['scan', 'github.com/JetBrains/example']);

test('malformed front matter → the directory name, no description and a warning', () => {
  const parsed = parseSkill(readFileSync(join(FIXTURE, '.agents/skills/release-checklist/SKILL.md'), 'utf8'));
  assert.equal(parsed.name, undefined);
  assert.equal(parsed.description, '');
  assert.equal(
    parsed.warning,
    'malformed front matter: Nested mappings are not allowed in compact mappings at line 3, column 14; using the directory name',
  );
});

test('scan prints the repository, then each skill with its first sentence and pinned link', () => {
  assert.equal(example.code, 0, example.stderr);
  assert.equal(
    example.stdout,
    [
      'JetBrains/example · 1 skill',
      'commits — Write commit messages the way this repository does.',
      `  https://github.com/JetBrains/example/blob/${EXAMPLE_COMMIT}/.claude/skills/commits/SKILL.md`,
    ].join('\n'),
  );
});

test('./fixture: every skill, sorted by name, linked to its file, with a warning for the malformed one', () => {
  const root = pathToFileURL(FIXTURE).href;
  assert.equal(fixture.code, 0);
  assert.equal(
    fixture.stdout,
    [
      'fixture · 4 skills',
      "code-style — Follow the project's code style.",
      `  ${root}/.github/skills/code-style/SKILL.md`,
      'commits — Write commit messages the way this repository does.',
      `  ${root}/.agents/skills/commits/SKILL.md`,
      '  also in .claude/skills/commits/SKILL.md',
      'release-checklist',
      `  ${root}/.agents/skills/release-checklist/SKILL.md`,
      'triage — Triage a new issue the way this repository does.',
      `  ${root}/docs/workflows/triage/SKILL.md`,
    ].join('\n'),
  );
  assert.match(fixture.stderr, /^warning: \.agents\/skills\/release-checklist\/SKILL\.md: malformed front matter: /);
});

test('a skill in any agents\' folders side by side → one skill, from .agents, with the others as copies', async () => {
  const commit = EXAMPLE_COMMIT;
  const paths = [
    '.cursor/skills/deploy/SKILL.md',
    '.opencode/skill/deploy/SKILL.md',
    'agent/skills/deploy/SKILL.md',
    'docs/skills/deploy/SKILL.md',
    'plugins/web/.claude/skills/lint/SKILL.md',
    'plugins/web/.gemini/skills/lint/SKILL.md',
    'plugins/web/.agents/skills/lint/SKILL.md',
    'plugins/api/.claude/skills/lint/SKILL.md',
  ];
  const listed = ['.cursor/skills/deploy', 'docs/skills/deploy', 'plugins/web/.agents/skills/lint', 'plugins/api/.claude/skills/lint'];
  const github = replay({
    'https://api.github.com/repos/JetBrains/copies': { status: 200, body: { full_name: 'JetBrains/copies', default_branch: 'main' } },
    'https://api.github.com/repos/JetBrains/copies/commits/main': { status: 200, body: { sha: commit } },
    [`https://api.github.com/repos/JetBrains/copies/git/trees/${commit}?recursive=1`]: {
      status: 200,
      body: { truncated: false, tree: paths.map((path) => ({ path, mode: '100644', type: 'blob', sha: '0' })) },
    },
    ...Object.fromEntries(
      listed.map((directory) => [
        `https://raw.githubusercontent.com/JetBrains/copies/${commit}/${directory}/SKILL.md`,
        { status: 200, body: `---\nname: ${directory.split('/').at(-1)}\ndescription: A skill.\n---\n` },
      ]),
    ),
  });
  const result = await scan(await openGitHub('https://github.com/JetBrains/copies', { fetch: github }));
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(
    result.skills.map(({ path, copies }) => ({ path, copies })),
    [
      // Not in .agents: the first by path. docs/ is not an agent's folder.
      { path: '.cursor/skills/deploy/SKILL.md', copies: ['.opencode/skill/deploy/SKILL.md', 'agent/skills/deploy/SKILL.md'] },
      { path: 'docs/skills/deploy/SKILL.md', copies: [] },
      // Another place in the repository: another skill.
      { path: 'plugins/api/.claude/skills/lint/SKILL.md', copies: [] },
      {
        path: 'plugins/web/.agents/skills/lint/SKILL.md',
        copies: ['plugins/web/.claude/skills/lint/SKILL.md', 'plugins/web/.gemini/skills/lint/SKILL.md'],
      },
    ],
  );
});

test('a large tree without a token → the listed part, wherever the skills are, the agents\' folders in full, a warning', async () => {
  const commit = EXAMPLE_COMMIT;
  const blob = (path: string) => ({ path, mode: '100644', type: 'blob', sha: '0' });
  const tree = (path: string, sha: string) => ({ path, mode: '040000', type: 'tree', sha });
  const raw = (path: string) => [
    `https://raw.githubusercontent.com/JetBrains/large/${commit}/${path}`,
    { status: 200, body: `---\nname: ${path.split('/').at(-2)}\ndescription: A skill.\n---\n` },
  ];
  const trees = `https://api.github.com/repos/JetBrains/large/git/trees`;
  const github = replay({
    'https://api.github.com/repos/JetBrains/large': { status: 200, body: { full_name: 'JetBrains/large', default_branch: 'main' } },
    'https://api.github.com/repos/JetBrains/large/commits/main': { status: 200, body: { sha: commit } },
    // GitHub stops listing at its limit: the triage workflow is in, .claude/skills only in part.
    [`${trees}/${commit}?recursive=1`]: {
      status: 200,
      body: { truncated: true, tree: [blob('build/workflows/triage/SKILL.md'), blob('.claude/skills/commits/SKILL.md')] },
    },
    [`${trees}/${commit}`]: { status: 200, body: { truncated: false, tree: [tree('.claude', 'claude'), tree('build', 'build')] } },
    [`${trees}/claude`]: { status: 200, body: { truncated: false, tree: [tree('skills', 'skills')] } },
    [`${trees}/skills?recursive=1`]: {
      status: 200,
      body: { truncated: false, tree: [blob('commits/SKILL.md'), blob('review/SKILL.md')] },
    },
    ...Object.fromEntries(
      ['build/workflows/triage/SKILL.md', '.claude/skills/commits/SKILL.md', '.claude/skills/review/SKILL.md'].map(raw),
    ),
  });
  const result = await scan(await openGitHub('https://github.com/JetBrains/large', { fetch: github }));
  assert.deepEqual(
    result.skills.map(({ path, copies }) => ({ path, copies })),
    [
      { path: '.claude/skills/commits/SKILL.md', copies: [] },
      { path: '.claude/skills/review/SKILL.md', copies: [] },
      { path: 'build/workflows/triage/SKILL.md', copies: [] },
    ],
  );
  assert.deepEqual(result.warnings, [
    'the tree is too large to list at once; looked in the part GitHub listed and in .agents/skills, .claude/skills, .github/skills, agent/skills (GITHUB_TOKEN searches everywhere)',
  ]);
});

test('the CLI prints the result at once and stores nothing', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'skill-atlas-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const scanned = spawnSync(process.execPath, [CLI, 'scan', FIXTURE], { cwd, encoding: 'utf8' });
  assert.equal(scanned.status, 0, scanned.stderr);
  assert.equal(scanned.stdout, `${fixture.stdout}\n`);
  assert.deepEqual(readdirSync(cwd), []);
});

test('unreachable repository → a clear message, exit code 1', async () => {
  const missing = spawnSync(process.execPath, [CLI, 'scan', join(FIXTURE, 'no-such-directory')], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /^Not a GitHub URL or a readable directory: .*no-such-directory\n$/);

  // What GitHub answers for a repository that does not exist.
  const notFound = replay({ 'https://api.github.com/repos/JetBrains/no-such-repository': { status: 404, body: { message: 'Not Found' } } });
  await assert.rejects(openGitHub('https://github.com/JetBrains/no-such-repository', { fetch: notFound }), {
    message: 'Repository not found: https://github.com/JetBrains/no-such-repository',
  });

  const offline = await atlas(['scan', 'https://github.com/JetBrains/not-answered']);
  assert.equal(offline.code, 1);
  assert.match(offline.stderr, /^Cannot reach GitHub: not recorded: https:\/\/api\.github\.com\/repos\/JetBrains\/not-answered$/);
});

test('rate limit → a message that asks for GITHUB_TOKEN', async () => {
  const limited = replay({
    'https://api.github.com/repos/JetBrains/MPS': {
      status: 403,
      body: { message: 'API rate limit exceeded for 192.0.2.1. (But here is the good news: ...)' },
    },
  });
  await assert.rejects(openGitHub('https://github.com/JetBrains/MPS', { fetch: limited }), {
    message: 'GitHub rate limit reached; set GITHUB_TOKEN',
  });
});
