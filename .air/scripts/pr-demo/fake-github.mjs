// Preloaded with `node --import` into the recorded app: GitHub answers from the trusted
// fixture directory in DEMO_FIXTURE, and nothing else is reachable through fetch.
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

export const DEMO_COMMIT = 'de30de30de30de30de30de30de30de30de30de30';
const API = 'https://api.github.com/repos/';
const RAW = `https://raw.githubusercontent.com/demo/skills/${DEMO_COMMIT}/`;

async function walk(root, directory = root, files = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(root, path, files);
    else if (entry.isFile()) files.push(relative(root, path).split('\\').join('/'));
  }
  return files;
}

/** A fetch for GitHub's API and raw files, serving `demo/skills` from `fixture`. */
export function fakeGitHub(fixture) {
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  return async (input) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith(RAW)) {
      const path = decodeURIComponent(url.slice(RAW.length));
      if (path.split('/').includes('..')) return new Response('Not Found', { status: 404 });
      try { return new Response(await readFile(join(fixture, path))); } catch { return new Response('Not Found', { status: 404 }); }
    }
    if (url.startsWith(API)) {
      const path = url.slice(API.length);
      if (path.startsWith('demo/limited')) return json({ message: 'API rate limit exceeded' }, 403);
      if (path === 'demo/skills') return json({ full_name: 'demo/skills', default_branch: 'main' });
      if (path === 'demo/skills/commits/main') return json({ sha: DEMO_COMMIT });
      if (path === `demo/skills/git/trees/${DEMO_COMMIT}?recursive=1`) {
        const files = (await walk(fixture)).sort();
        return json({ truncated: false, tree: files.map((file) => ({ path: file, mode: '100644', type: 'blob', sha: DEMO_COMMIT })) });
      }
      return json({ message: 'Not Found' }, 404);
    }
    throw new TypeError(`fetch failed: ${url} is not available while recording`);
  };
}

if (process.env.DEMO_FIXTURE) globalThis.fetch = fakeGitHub(process.env.DEMO_FIXTURE);
