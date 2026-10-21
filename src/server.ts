import { createServer, type IncomingMessage } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { AtlasError } from './core/errors.ts';
import { openGitHub, parseGitHubUrl, parseOrganizationUrl, type GitHubOptions } from './core/github.ts';
import type { Source } from './core/scan.ts';
import { scanTarget } from './core/target.ts';
import { scanWithContents, withClusters } from './core/view.ts';
import { aiClusterSkills, type AiSkill, type AskModel } from './core/ai-cluster.ts';
import { askClaude } from './claude.ts';
import { browserApp } from './web/bundle.ts';

type Options = {
  open?: (input: string) => Promise<Source>;
  github?: GitHubOptions;
  /** The model for AI clusters; `claude -p` by default. */
  ask?: AskModel;
  /**
   * The code another page, such as the portable HTML, must send as `X-Skill-Atlas-Code` to ask
   * for AI clusters. Without it only this server's own page may. `npm start` prints it.
   */
  pairingCode?: string;
};

/** A random pairing code, easy to copy: 12 characters of base64url. */
export const newPairingCode = () => randomBytes(9).toString('base64url');

/** The largest AI clustering request body: names and descriptions of every skill. */
const BODY_LIMIT = 2_000_000;

export function createWebServer(options: Options = {}) {
  const github = options.github ?? { fetch, token: process.env.GITHUB_TOKEN || undefined };
  const open = options.open ?? ((input: string) => openGitHub(input, github));
  const ask = options.ask ?? askClaude();
  // One claude process at a time: each one costs tokens and takes a while.
  let clustering = false;
  /** This server's own page, a tool that sends no Origin, or a page with the pairing code. */
  const mayCluster = (request: IncomingMessage) => {
    const origin = request.headers.origin;
    // A loopback Host too, so a rebound DNS name cannot pass for this server's own page.
    const local = /^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(request.headers.host ?? '');
    if (origin === undefined || (local && origin === `http://${request.headers.host}`)) return true;
    const code = Buffer.from(String(request.headers['x-skill-atlas-code'] ?? ''));
    const expected = Buffer.from(options.pairingCode ?? '');
    return expected.length > 0 && code.length === expected.length && timingSafeEqual(code, expected);
  };
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
      if (url.pathname === '/api/ai-clusters') {
        // Readable from any page, including a file:// one; the pairing code is what grants access.
        response.setHeader('Access-Control-Allow-Origin', '*');
        if (request.method === 'OPTIONS') {
          response.writeHead(204, {
            'Access-Control-Allow-Methods': 'POST',
            'Access-Control-Allow-Headers': 'Content-Type, X-Skill-Atlas-Code',
            'Access-Control-Max-Age': '600',
            // Chrome asks before a page reaches a server on this machine.
            ...(request.headers['access-control-request-private-network'] === 'true' ? { 'Access-Control-Allow-Private-Network': 'true' } : {}),
          }).end();
          return;
        }
        if (request.method !== 'POST') { response.writeHead(405, { Allow: 'POST, OPTIONS' }).end(); return; }
        const json = (status: number, body: object) => response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
        if (!mayCluster(request)) {
          json(403, { error: 'The AI helper rejected the pairing code. Paste the code that npm start printed, then try again.' });
          return;
        }
        const skills = await readSkills(request);
        if (!skills) {
          json(400, { error: 'Send the skills to cluster as JSON: {"skills": [{"id", "name", "description"}]}.' });
          return;
        }
        if (clustering) {
          json(429, { error: 'Claude is already clustering skills for this server. Wait for it to finish, then try again.' });
          return;
        }
        clustering = true;
        try {
          json(200, await aiClusterSkills(skills, ask));
        } finally {
          clustering = false;
        }
        return;
      }
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
        const result = withClusters(await scanTarget(input, open, github, scanWithContents));
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(result));
        return;
      }
      const asset = assets.get(url.pathname);
      if (!asset) { response.writeHead(404).end('Not found'); return; }
      const body = url.pathname === '/app.js' ? await browserApp() : await readFile(new URL(`./web/${asset[0]}`, import.meta.url));
      response.writeHead(200, { 'Content-Type': asset[1] }).end(body);
    } catch (error) {
      response.writeHead(error instanceof AtlasError ? 502 : 500, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: error instanceof AtlasError ? error.message : 'Unable to scan the repository. Please try again.' }));
    }
  });
}

/** The skills of an AI clustering request, or undefined when the body is not a valid request. */
async function readSkills(request: IncomingMessage): Promise<AiSkill[] | undefined> {
  if (!/^application\/json\b/i.test(request.headers['content-type'] ?? '')) return undefined;
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > BODY_LIMIT) return undefined;
  }
  let skills: unknown;
  try {
    skills = (JSON.parse(body) as { skills?: unknown })?.skills;
  } catch {
    return undefined;
  }
  const valid = Array.isArray(skills) && skills.every((skill) => skill && typeof skill.id === 'string'
    && typeof skill.name === 'string' && typeof (skill.description ?? '') === 'string');
  return valid ? (skills as AiSkill[]).map(({ id, name, description }) => ({ id, name, description: description ?? '' })) : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3000);
  const pairingCode = process.env.SKILL_ATLAS_AI_CODE || newPairingCode();
  createWebServer({ pairingCode }).listen(port, '127.0.0.1', () => {
    console.log(`Skill Atlas: http://127.0.0.1:${port}`);
    console.log(`AI pairing code for skill-atlas.html: ${pairingCode}`);
  });
}
