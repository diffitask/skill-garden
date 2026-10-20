import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import type { AddressInfo } from 'node:net';
import { AtlasError } from './core/errors.ts';
import { openGitHub, parseGitHubUrl } from './core/github.ts';
import { skillLink } from './core/model.ts';
import { scan, type Source } from './core/scan.ts';

type Options = { open?: (input: string) => Promise<Source> };

export function createWebServer(options: Options = {}) {
  const open = options.open ?? ((input: string) => openGitHub(input, { fetch, token: process.env.GITHUB_TOKEN || undefined }));
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
        if (!parseGitHubUrl(input)) {
          response.writeHead(400, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ error: 'Enter a GitHub repository URL, such as https://github.com/owner/repository.' }));
          return;
        }
        const source = await open(input);
        const contents = new Map<string, string>();
        const result = await scan({ ...source, read: async (path) => {
          const bytes = await source.read(path);
          if (bytes) contents.set(path, new TextDecoder().decode(bytes));
          return bytes;
        } });
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ ...result, skills: result.skills.map((skill) => ({
          ...skill, link: skillLink(result.repository, skill), content: contents.get(skill.path),
        })) }));
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

/** Shared entry point for npm start and skill-atlas web. */
export function startWebServer() {
  const configuredPort = process.env.PORT ?? '3000';
  if (!/^\d+$/.test(configuredPort) || Number(configuredPort) > 65535) {
    console.error('PORT must be an integer between 0 and 65535.');
    process.exitCode = 1;
    return;
  }
  const port = Number(configuredPort);
  const server = createWebServer();
  server.on('error', (error: NodeJS.ErrnoException) => {
    console.error(error.code === 'EADDRINUSE'
      ? `Port ${port} is already in use. Stop the other server or set PORT to another port.`
      : `Unable to start Skill Atlas: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`Skill Atlas: http://localhost:${(server.address() as AddressInfo).port}`);
    console.log('Keep this process running; press Ctrl+C to stop.');
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startWebServer();
}
