import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** A single file that can be opened directly in a browser, without localhost. */
export async function portableHtml(): Promise<string> {
  const bundled = await build({
    entryPoints: [new URL('../src/standalone.ts', import.meta.url).pathname],
    bundle: true, write: false, platform: 'browser', format: 'iife', minify: true,
  });
  const [html, css] = await Promise.all([
    readFile(new URL('../src/web/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../src/web/style.css', import.meta.url), 'utf8'),
  ]);
  return html
    .replace('<link rel="stylesheet" href="/style.css">', () => `<style>${css}</style>`)
    .replace('  <script src="/app.js" defer></script>\n', '')
    .replace('href="/"', 'href="#"')
    .replace('LOCAL EXPLORER', 'REPOSITORY EXPLORER')
    .replace('id="github-access" hidden', 'id="github-access"')
    .replace('Finds SKILL.md files on each default branch. Organization scans include public repositories only. Set GITHUB_TOKEN when starting the server for private repositories or higher limits.', 'Browse a public GitHub repository or organization. Organization scans include public repositories only. If GitHub limits requests, enter a GitHub token below and try again.')
    .replace('</body>', () => `<script>${bundled.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script></body>`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const output = resolve(process.argv[2] ?? 'skill-atlas.html');
  await writeFile(output, await portableHtml());
  console.log(`Created ${output}`);
}
