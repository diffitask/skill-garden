// Records the same scenario in the web view at two revisions and compares key moments.
// See spec/pr-demo.md. PR code is untrusted: it runs with a minimal environment only.
import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { decodePNG, diffRegions } from './png.mjs';

const exec = promisify(execFile);
const here = fileURLToPath(new URL('.', import.meta.url));
const FAKE_GITHUB = join(here, 'fake-github.mjs');
const DEFAULT_FIXTURE = resolve(here, '../../../fixture');
const CAPTION = '__pr_demo_caption';
const LABELS = { before: 'Before', after: 'After' };

/** `Narrow screen results` → `narrow-screen-results` */
const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'moment';

/** Only what the app needs: no tokens, no Air or webhook secrets. */
function isolatedEnv(home, extra = {}) {
  return { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, ...extra };
}

/** Installing needs the registry: proxy settings pass through, unless they carry credentials. */
function networkEnv() {
  const names = ['HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'no_proxy', 'NODE_EXTRA_CA_CERTS', 'npm_config_registry'];
  return Object.fromEntries(names.filter((name) => process.env[name] && !process.env[name].includes('@')).map((name) => [name, process.env[name]]));
}

async function freePort() {
  const server = createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address();
  await new Promise((done) => server.close(done));
  return port;
}

export function validateScenario(scenario) {
  if (!scenario || !Array.isArray(scenario.steps) || scenario.steps.length === 0) throw new Error('A scenario needs steps');
  const actions = ['goto', 'fill', 'click', 'press', 'wait', 'viewport'];
  const names = new Set();
  for (const step of scenario.steps) {
    if (typeof step.name !== 'string' || !step.name.trim()) throw new Error('Every step needs a name');
    if (!actions.includes(step.action)) throw new Error(`Unknown action in step "${step.name}": ${step.action}`);
    if (step.moment && names.has(step.name)) throw new Error(`Duplicate moment name: ${step.name}`);
    if (step.moment) names.add(step.name);
    if (step.action === 'goto' && (typeof step.url !== 'string' || !step.url.startsWith('/'))) throw new Error(`Step "${step.name}" needs a local url`);
  }
  return scenario;
}

/** Starts `node src/server.ts` in the revision directory with GitHub replaced by the fixture. */
async function startApp(directory, fixture, home) {
  const port = await freePort();
  const child = spawn(process.execPath, ['--import', pathToFileURL(FAKE_GITHUB).href, 'src/server.ts'], {
    cwd: directory, env: isolatedEnv(home, { PORT: String(port), DEMO_FIXTURE: fixture }), stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const exited = new Promise((done) => child.once('exit', (code) => done(code)));
  const base = `http://127.0.0.1:${port}`;
  const stop = async () => { if (child.exitCode === null) { child.kill(); await exited; } };
  for (const deadline = Date.now() + 15000; Date.now() < deadline;) {
    if (child.exitCode !== null) throw new Error(`The app exited with code ${child.exitCode}: ${output.trim().slice(-500)}`);
    try {
      if ((await fetch(base)).ok) return { base, stop };
    } catch { /* not listening yet */ }
    await new Promise((done) => setTimeout(done, 100));
  }
  await stop();
  throw new Error(`The app did not start within 15 seconds: ${output.trim().slice(-500)}`);
}

async function runStep(page, base, step, timeout) {
  if (step.action === 'goto') await page.goto(base + step.url, { timeout });
  else if (step.action === 'fill') await page.locator(step.selector).first().fill(step.value ?? '', { timeout });
  else if (step.action === 'click') await page.locator(step.selector).first().click({ timeout });
  else if (step.action === 'press') await page.locator(step.selector ?? 'body').first().press(step.key, { timeout });
  else if (step.action === 'viewport') await page.setViewportSize({ width: step.width, height: step.height });
  else if (step.action === 'wait') {
    if (step.selector) {
      const locator = page.locator(step.selector);
      await (step.text ? locator.filter({ hasText: new RegExp(step.text, 'i') }) : locator).first().waitFor({ state: 'visible', timeout });
    } else await page.waitForTimeout(step.ms ?? 500);
  }
}

async function caption(page, text) {
  await page.evaluate(([id, value]) => {
    const element = document.getElementById(id);
    if (!element) return;
    element.textContent = value ?? '';
    element.hidden = value === undefined;
  }, [CAPTION, text]).catch(() => {});
}

/** One revision: a video of the whole scenario and a screenshot of every moment. */
async function recordRevision({ browser, directory, label, scenario, fixture, work, out, pace, timeout }) {
  const result = { video: null, error: null, steps: [], screenshots: {} };
  const home = await mkdtemp(join(work, `${label}-home-`));
  let app;
  try {
    app = await startApp(directory, fixture, home);
  } catch (error) {
    result.error = error.message;
    return result;
  }
  const viewport = scenario.viewport ?? { width: 1280, height: 800 };
  const videoDir = join(work, `${label}-video`);
  const context = await browser.newContext({ viewport, recordVideo: { dir: videoDir, size: viewport } });
  await context.addInitScript(([id, title]) => {
    addEventListener('DOMContentLoaded', () => {
      const element = document.createElement('div');
      element.id = id;
      element.setAttribute('aria-hidden', 'true');
      Object.assign(element.style, { position: 'fixed', left: '12px', bottom: '12px', zIndex: '2147483647', padding: '8px 12px',
        borderRadius: '6px', font: '600 14px system-ui, sans-serif', color: 'white', background: '#000000c0', pointerEvents: 'none' });
      element.dataset.revision = title;
      document.body.append(element);
    });
  }, [CAPTION, LABELS[label]]);
  const page = await context.newPage();
  try {
    for (const [index, step] of scenario.steps.entries()) {
      await caption(page, `${LABELS[label]} · ${step.name}`);
      try {
        await runStep(page, app.base, step, timeout);
        await caption(page, `${LABELS[label]} · ${step.name}`);
        result.steps.push({ name: step.name, ok: true });
      } catch (error) {
        const message = error.message.split('\n')[0];
        result.steps.push({ name: step.name, ok: false, error: message });
        if (step.moment) result.screenshots[step.name] = { error: message };
        continue;
      }
      if (step.moment) {
        await page.waitForTimeout(300); // let fonts and layout settle
        await caption(page, undefined);
        const file = join(out, 'screens', `${label}-${String(index + 1).padStart(2, '0')}-${slug(step.name)}.png`);
        await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
        await caption(page, `${LABELS[label]} · ${step.name}`);
        result.screenshots[step.name] = { file };
      }
      await page.waitForTimeout(pace);
    }
  } finally {
    const video = page.video();
    await context.close();
    await app.stop();
    if (video) {
      const webm = join(out, `${label}.webm`);
      await video.saveAs(webm);
      result.video = webm;
    }
  }
  return result;
}

async function hasFFmpeg() {
  try { await exec('ffmpeg', ['-version']); return true; } catch { return false; }
}

/** H.264 MP4 plays everywhere GitHub shows a video; the WebM stays when ffmpeg is missing. */
async function toMP4(webm) {
  const mp4 = webm.replace(/\.webm$/, '.mp4');
  await exec('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-movflags', '+faststart', mp4]);
  await rm(webm);
  return mp4;
}

/** A `Before | After` image with the changed regions outlined on both sides. */
async function compose(browser, { name, before, after, regions, labels, file }) {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const side = (title, png) => {
    const image = png ? `<img src="data:image/png;base64,${png.toString('base64')}">` : '<div class="missing">Not available in this revision</div>';
    const boxes = png ? regions.map((r) => `<i style="left:${r.x}px;top:${r.y}px;width:${r.width}px;height:${r.height}px"></i>`).join('') : '';
    return `<figure><figcaption>${title}</figcaption><div class="frame">${image}${boxes}</div></figure>`;
  };
  const escape = (text) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  await page.setContent(`<!doctype html><style>
    body{margin:0;background:#f6f8fa;font:15px system-ui,sans-serif;color:#1f2328}
    #sheet{display:inline-block;padding:16px}h1{font-size:18px;margin:0 0 12px}
    .sides{display:flex;gap:16px;align-items:flex-start}figure{margin:0}
    figcaption{font-weight:600;margin-bottom:6px}.frame{position:relative;border:1px solid #d0d7de;background:white;line-height:0}
    img{display:block}i{position:absolute;box-sizing:border-box;border:3px solid #e5534b;background:#e5534b26;border-radius:4px}
    .missing{width:480px;height:300px;display:grid;place-items:center;color:#6e7781;line-height:1.4}
  </style><div id="sheet"><h1>${escape(name)}</h1><div class="sides">${side(escape(labels.before), before)}${side(escape(labels.after), after)}</div></div>`);
  await page.waitForFunction(() => [...document.images].every((image) => image.complete));
  await page.locator('#sheet').screenshot({ path: file });
  await page.close();
}

/**
 * @param {{before: string, after: string, out: string, scenario?: any, fixture?: string,
 *   beforeLabel?: string, afterLabel?: string, pace?: number, timeout?: number}} options
 */
export async function record(options) {
  const scenario = validateScenario(options.scenario ?? JSON.parse(await readFile(join(here, 'scenario.json'), 'utf8')));
  const out = resolve(options.out);
  const fixture = resolve(options.fixture ?? DEFAULT_FIXTURE);
  await rm(join(out, 'screens'), { recursive: true, force: true });
  await rm(join(out, 'moments'), { recursive: true, force: true });
  await mkdir(join(out, 'screens'), { recursive: true });
  await mkdir(join(out, 'moments'), { recursive: true });
  const work = await mkdtemp(join(tmpdir(), 'pr-demo-'));
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const ffmpeg = await hasFFmpeg();
  try {
    const revisions = {};
    for (const label of ['before', 'after']) {
      revisions[label] = await recordRevision({ browser, directory: resolve(options[label]), label, scenario, fixture, work, out,
        pace: options.pace ?? 600, timeout: options.timeout ?? 5000 });
      if (revisions[label].video && ffmpeg) revisions[label].video = await toMP4(revisions[label].video);
    }
    const labels = { before: options.beforeLabel ?? 'Before', after: options.afterLabel ?? 'After' };
    const moments = [];
    for (const [index, step] of scenario.steps.entries()) {
      if (!step.moment) continue;
      const shots = { before: revisions.before.screenshots[step.name], after: revisions.after.screenshots[step.name] };
      const png = {};
      for (const label of ['before', 'after']) if (shots[label]?.file) png[label] = await readFile(shots[label].file);
      const errors = {
        before: revisions.before.error ?? shots.before?.error ?? null,
        after: revisions.after.error ?? shots.after?.error ?? null,
      };
      const moment = { name: step.name, status: 'unavailable', regions: [], image: null, errors };
      if (png.before && png.after) {
        moment.regions = diffRegions(decodePNG(png.before), decodePNG(png.after));
        moment.status = moment.regions.length ? 'changed' : 'unchanged';
      }
      if (moment.status !== 'unchanged' && (png.before || png.after)) {
        moment.image = join('moments', `${String(index + 1).padStart(2, '0')}-${slug(step.name)}.png`);
        await compose(browser, { name: step.name, ...png, regions: moment.regions, labels, file: join(out, moment.image) });
      }
      moments.push(moment);
    }
    const manifest = {
      labels,
      before: { video: revisions.before.video && revisions.before.video.slice(out.length + 1), error: revisions.before.error, steps: revisions.before.steps },
      after: { video: revisions.after.video && revisions.after.video.slice(out.length + 1), error: revisions.after.error, steps: revisions.after.steps },
      moments,
    };
    await writeFile(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    return manifest;
  } finally {
    await browser.close();
    await rm(work, { recursive: true, force: true });
  }
}

/** A detached worktree of `ref` with dependencies installed, no lifecycle scripts, no credentials. */
export async function checkout(repo, ref, directory) {
  await exec('git', ['-C', repo, 'worktree', 'add', '--force', '--detach', directory, ref]);
  const home = await mkdtemp(join(tmpdir(), 'pr-demo-npm-'));
  try {
    await exec('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: directory, env: isolatedEnv(home, networkEnv()), maxBuffer: 16 * 1024 * 1024 });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
  return directory;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: {
    repo: { type: 'string', default: '.' }, 'before-ref': { type: 'string' }, 'after-ref': { type: 'string' },
    before: { type: 'string' }, after: { type: 'string' }, out: { type: 'string' }, scenario: { type: 'string' },
  } });
  if (!values.out) throw new Error('Pass --out <directory>');
  const worktrees = [];
  const dirs = {};
  try {
    for (const label of ['before', 'after']) {
      const ref = values[`${label}-ref`];
      if (values[label]) dirs[label] = values[label];
      else if (ref) {
        const { stdout } = await exec('git', ['-C', values.repo, 'rev-parse', '--verify', `${ref}^{commit}`]);
        const directory = await mkdtemp(join(tmpdir(), `pr-demo-${label}-`));
        worktrees.push(directory); // removed even when installing fails
        dirs[label] = await checkout(values.repo, stdout.trim(), directory);
        dirs[`${label}Label`] = `${LABELS[label]} · ${stdout.trim().slice(0, 7)}`;
      } else throw new Error(`Pass --${label} <directory> or --${label}-ref <commit>`);
    }
    const scenario = values.scenario ? JSON.parse(await readFile(values.scenario, 'utf8')) : undefined;
    const manifest = await record({ before: dirs.before, after: dirs.after, out: values.out, scenario,
      beforeLabel: dirs.beforeLabel, afterLabel: dirs.afterLabel });
    for (const moment of manifest.moments) console.log(`${moment.status.padEnd(11)} ${moment.name}${moment.image ? ` → ${moment.image}` : ''}`);
    for (const label of ['before', 'after']) console.log(`${label} video: ${manifest[label].video ?? `none (${manifest[label].error})`}`);
  } finally {
    for (const directory of worktrees) {
      await exec('git', ['-C', values.repo, 'worktree', 'remove', '--force', directory]).catch(() => rm(directory, { recursive: true, force: true }));
    }
  }
}
