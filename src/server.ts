import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { AtlasError } from './core/errors.ts';
import { openGitHub, parseGitHubUrl, parseOrganizationUrl, type GitHubOptions } from './core/github.ts';
import type { Source } from './core/scan.ts';
import { scanTarget } from './core/target.ts';
import { scanWithContents } from './core/view.ts';

type Options = { open?: (input: string) => Promise<Source>; github?: GitHubOptions };

export function createWebServer(options: Options = {}) {
  const github = options.github ?? { fetch, token: process.env.GITHUB_TOKEN || undefined };
  const open = options.open ?? ((input: string) => openGitHub(input, github));
  const assets = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
    ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ]);
  return createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    response.setHeader('Cache-Control', 'no-store');
    const url = new URL(request.url ?? '/', 'http://localhost');
    try {
      if (request.method !== 'GET') {
        response.writeHead(405, { Allow: 'GET' }).end();
        return;
      }
      if (url.pathname === '/api/scan') {
        const input = url.searchParams.get('repository') ?? '';
        if (!parseGitHubUrl(input) && !parseOrganizationUrl(input)) {
          response.writeHead(400, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ error: 'Enter a GitHub repository URL or organization URL, such as https://github.com/owner/repository or https://github.com/organization.' }));
          return;
        }
        const result = await scanTarget(input, open, github, scanWithContents);
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(result));
        return;
      }
      const asset = assets.get(url.pathname);
      if (!asset) { response.writeHead(404).end('Not found'); return; }
      const body = await readFile(new URL(`./web/${asset[0]}`, import.meta.url));
      response.writeHead(200, { 'Content-Type': asset[1] }).end(body);
    } catch (error) {
      response.writeHead(error instanceof AtlasError ? 502 : 500, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: error instanceof AtlasError ? error.message : 'Unable to scan the repository. Please try again.' }));
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3000);
  createWebServer().listen(port, '127.0.0.1', () => console.log(`Skill Atlas: http://127.0.0.1:${port}`));
}
