#!/usr/bin/env node
// The Node client: a GitHub repository through the GitHub API, or a local directory; stdout and
// stderr. Nothing is stored.
import { readFile } from 'node:fs/promises';
import { run } from './commands.ts';
import { openGitHub, parseGitHubUrl } from './core/github.ts';
import { openDirectory } from './local.ts';

const args = process.argv.slice(2);

if (args.length === 1 && args[0] === '--version') {
  const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  console.log(version);
  process.exitCode = 0;
} else {
  const token = process.env.GITHUB_TOKEN || undefined;
  process.exitCode = await run(args, {
    open: (input) => (parseGitHubUrl(input) ? openGitHub(input, { fetch, token }) : openDirectory(input)),
    print: (text) => console.log(text),
    error: (text) => console.error(text),
  });
}
