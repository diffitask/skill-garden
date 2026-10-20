// Records the same scenario in the web view at two revisions and compares key moments.
// See spec/pr-demo.md. PR code is untrusted: it runs with a minimal environment only.
import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { installOverlay } from './overlay.mjs';
import { decodePNG, diffRegions } from './png.mjs';
import { composeSheet } from './sheet.mjs';

const exec = promisify(execFile);
const here = fileURLToPath(new URL('.', import.meta.url));
const FAKE_GITHUB = join(here, 'fake-github.mjs');
const DEFAULT_FIXTURE = resolve(here, '../../../fixture');
const LABELS = { before: 'Before this PR', after: 'With this PR' };
const ACTIONS = ['goto', 'click', 'type', 'fill', 'press', 'wait', 'scroll', 'pause'];
const MAX_NOTE = 90;

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
  const names = new Set();
  for (const step of scenario.steps) {
    if (typeof step.name !== 'string' || !step.name.trim()) throw new Error('Every step needs a name');
    if (step.action === 'viewport') {
      throw new Error(`Step "${step.name}": the video frame has a fixed size, so resizing mid-recording shrinks the page into a corner. Record a separate scenario with its own viewport instead.`);
    }
    if (!ACTIONS.includes(step.action)) throw new Error(`Unknown action in step "${step.name}": ${step.action}`);
    if (step.moment && names.has(step.name)) throw new Error(`Duplicate moment name: ${step.name}`);
    if (step.moment) names.add(step.name);
    if (step.action === 'goto' && (typeof step.url !== 'string' || !step.url.startsWith('/'))) throw new Error(`Step "${step.name}" needs a local url`);
    if (['click', 'type', 'fill', 'scroll'].includes(step.action) && typeof step.selector !== 'string') throw new Error(`Step "${step.name}" needs a selector`);
    for (const key of ['note', 'beforeNote']) {
      if (step[key] !== undefined && (typeof step[key] !== 'string' || step[key].length > MAX_NOTE)) {
        throw new Error(`Step "${step.name}": ${key} must be a short hint of at most ${MAX_NOTE} characters`);
      }
    }
    if (step.focus !== undefined && typeof step.focus !== 'string') throw new Error(`Step "${step.name}": focus must be a selector`);
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

/** Long enough to read the hint at a relaxed pace while watching the screen. */
const readingTime = (text) => (text ? 1600 + 55 * text.length : 0);

function titleCard(title, label, kind) {
  const escape = (text) => String(text).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const color = kind === 'before' ? '#d29922' : '#3fb950';
  return `<!doctype html><body style="margin:0;height:100vh;display:grid;place-items:center;background:#0d1117;color:#e6edf3;font-family:system-ui,sans-serif">
    <div style="text-align:center"><div style="display:inline-block;padding:8px 18px;border-radius:8px;background:${color};color:#0d1117;font:700 22px system-ui">${escape(label)}</div>
    <h1 style="font-size:40px;margin:28px 0 0;font-weight:650">${escape(title)}</h1></div></body>`;
}

/** Drives one revision: a paced, annotated video of the scenario and a screenshot of every moment. */
class Director {
  constructor(page, { base, label, badge, viewport, speed, timeout }) {
    Object.assign(this, { page, base, label, badge, viewport, speed, timeout });
    this.cursor = [viewport.width / 2, viewport.height / 2];
  }

  wait(ms) { return ms > 0 && this.speed > 0 ? this.page.waitForTimeout(ms * this.speed) : undefined; }

  overlay(name, ...args) {
    return this.page.evaluate(([fn, values]) => window.__demo?.[fn](...values), [name, args]).catch(() => {});
  }

  async restoreOverlay() {
    await this.overlay('badge', this.badge, this.label);
    await this.overlay('cursor', ...this.cursor, false);
  }

  /** Scrolls smoothly so the element is in view, unless it already is. */
  async reveal(locator) {
    const visible = await locator.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= innerHeight;
    });
    if (visible) return;
    await locator.evaluate((element) => element.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    await this.wait(800);
    if (this.speed === 0) await locator.scrollIntoViewIfNeeded();
  }

  /** Glides the visible cursor to the element, pauses on it, and clicks with a ripple. */
  async pointAndClick(locator) {
    await locator.waitFor({ state: 'visible', timeout: this.timeout });
    await this.reveal(locator);
    const box = await locator.boundingBox();
    const x = Math.round(box.x + Math.min(box.width / 2, 60)), y = Math.round(box.y + box.height / 2);
    this.cursor = [x, y];
    await this.overlay('cursor', x, y);
    await this.page.mouse.move(x, y);
    await this.wait(800); // the glide, then a moment on the target before clicking
    await this.overlay('ripple', x, y);
    await this.page.mouse.click(x, y);
  }

  async act(step) {
    const target = () => this.page.locator(step.selector).first();
    if (step.action === 'goto') {
      await this.page.goto(this.base + step.url, { timeout: this.timeout });
      await this.restoreOverlay();
    } else if (step.action === 'click') await this.pointAndClick(target());
    else if (step.action === 'type') {
      await this.pointAndClick(target());
      await target().fill('');
      await target().pressSequentially(step.value ?? '', { delay: 70 * this.speed });
    } else if (step.action === 'fill') await target().fill(step.value ?? '', { timeout: this.timeout });
    else if (step.action === 'press') await (step.selector ? target().press(step.key) : this.page.keyboard.press(step.key));
    else if (step.action === 'scroll') await this.reveal(target());
    else if (step.action === 'pause') await this.wait(step.ms ?? 1000);
    else if (step.action === 'wait') {
      if (!step.selector) return this.wait(step.ms ?? 1000);
      const locator = this.page.locator(step.selector);
      await (step.text ? locator.filter({ hasText: new RegExp(step.text, 'i') }) : locator).first().waitFor({ state: 'visible', timeout: this.timeout });
    }
  }

  /** The focused element's box in the viewport, scrolled into view; undefined when absent. */
  async focusRect(selector) {
    const locator = this.page.locator(selector).first();
    if (!(await locator.count()) || !(await locator.isVisible())) return undefined;
    await this.reveal(locator);
    const box = await locator.boundingBox();
    if (!box) return undefined;
    const x = Math.max(0, box.x), y = Math.max(0, box.y);
    return { x: Math.round(x), y: Math.round(y),
      width: Math.round(Math.min(this.viewport.width, box.x + box.width) - x), height: Math.round(Math.min(this.viewport.height, box.y + box.height) - y) };
  }

  async screenshot(file) {
    await this.overlay('hide', true);
    await this.page.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
    await this.overlay('hide', false);
  }
}

async function recordRevision({ browser, directory, label, title, badge, scenario, fixture, work, out, speed, timeout }) {
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
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, recordVideo: { dir: join(work, `${label}-video`), size: viewport } });
  await context.addInitScript(installOverlay);
  const page = await context.newPage();
  const director = new Director(page, { base: app.base, label, badge, viewport, speed, timeout });
  try {
    await page.setContent(titleCard(title, badge, label));
    await director.wait(2800);
    let skipping = false;
    for (const [index, step] of scenario.steps.entries()) {
      const note = label === 'before' ? step.beforeNote ?? step.note : step.note;
      if (label === 'before' && step.afterOnly) {
        // The feature is new: show once why the next steps are missing, then move on.
        if (!skipping) {
          const hint = step.beforeNote ?? 'Not in this version yet: the PR adds the next steps';
          await director.overlay('caption', hint);
          await director.wait(readingTime(hint));
        }
        skipping = true;
        result.steps.push({ name: step.name, ok: false, skipped: true });
        if (step.moment) result.screenshots[step.name] = { absent: true };
        continue;
      }
      skipping = false;
      await director.overlay('unspot');
      await director.overlay('caption', note ?? '');
      try {
        await director.act(step);
        result.steps.push({ name: step.name, ok: true });
      } catch (error) {
        const message = error.message.split('\n')[0];
        result.steps.push({ name: step.name, ok: false, error: message });
        if (step.moment) result.screenshots[step.name] = { error: message };
        await director.overlay('caption', `“${step.name}” is not available in this version`);
        await director.wait(1800);
        continue;
      }
      await director.wait(500); // let the result render before pointing at it
      const rect = step.focus ? await director.focusRect(step.focus) : undefined;
      if (step.moment) {
        const file = join(out, 'screens', `${label}-${String(index + 1).padStart(2, '0')}-${slug(step.name)}.png`);
        await director.screenshot(file);
        result.screenshots[step.name] = { file, rect, size: viewport };
      }
      if (rect) {
        const low = rect.y + rect.height > viewport.height - 130;
        if (note) await director.overlay('caption', note, low);
        await director.overlay('spotlight', rect, step.tag ?? (label === 'after' ? 'Changed by this PR' : 'Before this PR'));
        await director.wait(Math.max(3000, readingTime(note)));
        await director.overlay('unspot');
      } else await director.wait(Math.max(step.moment ? 1500 : 600, readingTime(note)));
    }
    await director.overlay('caption', '');
    await director.wait(1500);
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
  await exec('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-movflags', '+faststart', mp4]);
  await rm(webm);
  return mp4;
}

const area = (r) => r.width * r.height;
const intersects = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
function union(regions) {
  const x = Math.min(...regions.map((r) => r.x)), y = Math.min(...regions.map((r) => r.y));
  return { x, y, width: Math.max(...regions.map((r) => r.x + r.width)) - x, height: Math.max(...regions.map((r) => r.y + r.height)) - y };
}

/**
 * @param {{before: string, after: string, out: string, scenario?: any, fixture?: string,
 *   beforeLabel?: string, afterLabel?: string, speed?: number, timeout?: number}} options
 *   speed scales every pause: 1 is the watchable pace, 0 records as fast as possible (tests).
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
  const labels = { before: options.beforeLabel ?? LABELS.before, after: options.afterLabel ?? LABELS.after };
  const title = scenario.title ?? 'Skill Atlas';
  try {
    const revisions = {};
    for (const label of ['before', 'after']) {
      revisions[label] = await recordRevision({ browser, directory: resolve(options[label]), label, title, badge: labels[label], scenario, fixture,
        work, out, speed: options.speed ?? 1, timeout: options.timeout ?? 5000 });
      if (revisions[label].video && ffmpeg) revisions[label].video = await toMP4(revisions[label].video);
    }
    const moments = [];
    for (const [index, step] of scenario.steps.entries()) {
      if (!step.moment) continue;
      const number = moments.length + 1;
      const shots = { before: revisions.before.screenshots[step.name], after: revisions.after.screenshots[step.name] };
      const png = {};
      for (const label of ['before', 'after']) if (shots[label]?.file) png[label] = await readFile(shots[label].file);
      const errors = {
        before: revisions.before.error ?? shots.before?.error ?? null,
        after: revisions.after.error ?? shots.after?.error ?? null,
      };
      const moment = { number, name: step.name, note: step.note ?? null, beforeNote: step.beforeNote ?? null, status: 'unavailable',
        focus: { before: shots.before?.rect ?? null, after: shots.after?.rect ?? null }, autoFocus: false, otherChanges: 0, regions: [], image: null, errors };
      if (png.before && png.after) {
        // Screenshots are 2x; regions are kept in CSS pixels, like the focus boxes.
        const [a, b] = [decodePNG(png.before), decodePNG(png.after)];
        const ratio = a.width / shots.before.size.width;
        moment.regions = diffRegions(a, b, { cell: 8 * ratio, padding: 6 * ratio }).map((r) => ({
          x: Math.floor(r.x / ratio), y: Math.floor(r.y / ratio), width: Math.ceil(r.width / ratio), height: Math.ceil(r.height / ratio) }));
        moment.status = moment.regions.length ? 'changed' : 'unchanged';
      } else if (png.after && shots.before?.absent) moment.status = 'new';
      const viewport = shots.after?.size ?? shots.before?.size;
      if (moment.status === 'changed' && !step.focus) {
        // No author focus: outline the detected change only when it is one readable area.
        const detected = union(moment.regions);
        if (area(detected) <= 0.4 * viewport.width * viewport.height) {
          moment.focus = { before: detected, after: detected };
          moment.autoFocus = true;
        }
      }
      const focusArea = moment.focus.after ?? moment.focus.before;
      if (focusArea) moment.otherChanges = moment.regions.filter((region) => !intersects(region, focusArea)).length;
      if (moment.status !== 'unchanged' && (png.before || png.after)) {
        moment.image = join('moments', `${String(index + 1).padStart(2, '0')}-${slug(step.name)}.png`);
        const missing = (label) => (shots[label]?.absent ? 'Not in this version: the PR adds it' : `Could not show this step: ${errors[label] ?? 'no screenshot'}`);
        const side = (label) => ({
          png: png[label], size: shots[label]?.size, rect: moment.focus[label], label: labels[label], missing: missing(label),
          banner: png[label] && !moment.focus[label] && focusArea ? (label === 'before' ? 'Not present before this PR' : 'Removed by this PR')
            : png[label] && !focusArea && moment.status === 'changed' ? 'Changes across the whole page: see the video' : undefined,
        });
        const note = moment.autoFocus ? `${step.note ? `${step.note} · ` : ''}Outlined automatically: the area that differs` : step.note;
        await composeSheet(browser, { number, name: step.name, note, before: side('before'), after: side('after'), file: join(out, moment.image) });
      }
      moments.push(moment);
    }
    const manifest = {
      title,
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
    for (const moment of manifest.moments) console.log(`${String(moment.number).padStart(2)}. ${moment.status.padEnd(11)} ${moment.name}${moment.image ? ` → ${moment.image}` : ''}`);
    for (const label of ['before', 'after']) console.log(`${label} video: ${manifest[label].video ?? `none (${manifest[label].error})`}`);
  } finally {
    for (const directory of worktrees) {
      await exec('git', ['-C', values.repo, 'worktree', 'remove', '--force', directory]).catch(() => rm(directory, { recursive: true, force: true }));
    }
  }
}
