// Runs the commands the way the CLI does, with GitHub answering from EXAMPLE below.
import { fileURLToPath } from 'node:url';
import { run } from '../src/commands.ts';
import { openGitHub, parseGitHubUrl } from '../src/core/github.ts';
import { scan } from '../src/core/scan.ts';
import { replay, type Recording } from '../src/core/replay.ts';
import { openDirectory } from '../src/local.ts';

export const FIXTURE = fileURLToPath(new URL('../fixture', import.meta.url));
export const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

/** The commit GitHub answers for JetBrains/example. */
export const EXAMPLE_COMMIT = '5ab6270ab772d113e8ad52ebfcaa0109c522ae00';

/** What GitHub answers for a small repository, JetBrains/example, with one skill. */
const EXAMPLE: Recording = {
  'https://api.github.com/repos/JetBrains/example': { status: 200, body: { full_name: 'JetBrains/example', default_branch: 'main' } },
  'https://api.github.com/repos/JetBrains/example/commits/main': { status: 200, body: { sha: EXAMPLE_COMMIT } },
  'https://api.github.com/search/code?q=filename:SKILL.md+repo:JetBrains/example&per_page=100&page=1': {
    status: 200,
    body: { total_count: 1, items: [{ path: '.claude/skills/commits/SKILL.md' }] },
  },
  [`https://raw.githubusercontent.com/JetBrains/example/${EXAMPLE_COMMIT}/.claude/skills/commits/SKILL.md`]: {
    status: 200,
    body: '---\nname: commits\ndescription: Write commit messages the way this repository does. Use for every commit.\n---\n# Commits\n',
  },
};

const github = replay(EXAMPLE);

/** `skill-atlas <args>`, as the CLI runs it, with GitHub answering from EXAMPLE. */
export async function atlas(args: string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await run(args, {
    // With a token, through code search, as EXAMPLE answers it.
    open: (input) => (parseGitHubUrl(input) ? openGitHub(input, { fetch: github, token: 'test' }) : openDirectory(input)),
    print: (text) => stdout.push(text),
    error: (text) => stderr.push(text),
  });
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}

/**
 * A scan of JetBrains/files, a GitHub repository with these files and these symbolic
 * links: each SKILL.md names its directory; at the root, it has no name.
 */
export async function scanGitHubFiles(paths: string[], links: string[] = []) {
  const recording: Recording = {
    'https://api.github.com/repos/JetBrains/files': { status: 200, body: { full_name: 'JetBrains/files', default_branch: 'main' } },
    'https://api.github.com/repos/JetBrains/files/commits/main': { status: 200, body: { sha: EXAMPLE_COMMIT } },
    [`https://api.github.com/repos/JetBrains/files/git/trees/${EXAMPLE_COMMIT}?recursive=1`]: {
      status: 200,
      body: {
        truncated: false,
        tree: [
          ...paths.map((path) => ({ path, mode: '100644', type: 'blob', sha: '0' })),
          ...links.map((path) => ({ path, mode: '120000', type: 'blob', sha: '0' })),
        ],
      },
    },
  };
  for (const path of paths) {
    recording[`https://raw.githubusercontent.com/JetBrains/files/${EXAMPLE_COMMIT}/${path}`] = {
      status: 200,
      body: `---\n${path.includes('/') ? `name: ${path.split('/').at(-2)}\n` : ''}description: A skill.\n---\n`,
    };
  }
  return scan(await openGitHub('https://github.com/JetBrains/files', { fetch: replay(recording) }));
}
