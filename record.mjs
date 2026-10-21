// Reproduce: npm ci in both revisions, install Playwright Chromium, then:
// node record.mjs /path/to/base-checkout /path/to/head-checkout [output-dir]
// Uses replay.json for GitHub transport and serve.mjs for a disclosed model stub.
import assert from 'node:assert/strict';
import { showChapter, showCallout, clearCallout } from './annotations.mjs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const [baseRoot, headRoot, output = dirname(fileURLToPath(import.meta.url))] = process.argv.slice(2);
if (!baseRoot || !headRoot) throw new Error('Provide base and head checkout directories');
const require = createRequire(join(headRoot, 'package.json'));
const { chromium } = require('playwright');
await mkdir(output, { recursive: true });
const safeEnv = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'PLAYWRIGHT_BROWSERS_PATH'].filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
async function start(root) {
  const child = spawn(process.execPath, [fileURLToPath(new URL('./serve.mjs', import.meta.url)), root], { env: safeEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = '';
  child.stderr.on('data', (chunk) => { errors += chunk; });
  const url = await new Promise((resolve, reject) => {
    let text = '';
    child.stdout.on('data', (chunk) => { text += chunk; if (text.includes('\n')) resolve(JSON.parse(text.split('\n')[0]).url); });
    child.once('exit', (code) => reject(new Error(`Server exited ${code}: ${errors}`)));
  });
  return { child, url };
}
const servers = [], observations = [], moments = [];
const browser = await chromium.launch({ env: safeEnv });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: output, size: { width: 1280, height: 720 } }, bypassCSP: true });
const page = await context.newPage();
const video = page.video();
let began = Date.now();
const pause = (ms) => page.waitForTimeout(ms);
const timestamp = () => Math.round((Date.now() - began) / 100) / 10;
async function chapter(label, summary, revision) {
  moments.push({ seconds: timestamp(), kind: 'chapter', label, summary });
  await showChapter(page, { label, summary, detail: `PR #26 · ${revision} · Replayed GitHub + stubbed model`, holdMs: 2400 });
}
async function note(selector, text, side = 'right') {
  moments.push({ seconds: timestamp(), kind: 'callout', text, selector });
  await showCallout(page, { selector, text, side });
}
async function point(selector) {
  const rect = await page.locator(selector).boundingBox();
  if (!rect) throw new Error(`Cannot point to ${selector}`);
  await page.mouse.move(rect.x + rect.width * .6, rect.y + rect.height / 2, { steps: 16 });
}
async function type(value) {
  await point('#filter-skills');
  await page.locator('#filter-skills').fill(value);
}
async function setup(url) {
  await page.goto(url);
  await page.locator('#repository').fill('https://github.com/Example');
  await page.locator('#scan').click();
  await page.waitForFunction(() => document.querySelector('#count').textContent === '4 of 4 skills');
  const y = await page.locator('.results-heading').evaluate((element) => element.getBoundingClientRect().top + window.scrollY - 24);
  await page.evaluate((y) => window.scrollTo(0, y), y);
  await page.mouse.move(1200, 690);
}
async function snapshot(name, phase) {
  const data = await page.evaluate(() => ({
    count: document.querySelector('#count').textContent,
    clusterCount: document.querySelector('#ai-cluster-count').textContent,
    cards: [...document.querySelectorAll('#ai-cluster-list .cluster')].length,
    unsent: document.querySelector('#ai-unsent')?.textContent ?? null,
    noClustersVisible: !document.querySelector('#ai-no-clusters').hidden,
    unclustered: document.querySelector('#ai-unclustered').textContent,
    status: document.querySelector('#ai-status').textContent,
  }));
  observations.push({ name, phase, seconds: timestamp(), ...data });
  await page.screenshot({ path: join(output, name + '.png') });
  return data;
}
const edits = {};
try {
  servers.push(await start(baseRoot), await start(headRoot));
  began = Date.now();
  for (const [index, phase] of ['Before', 'After'].entries()) {
    await setup(servers[index].url);
    if (!index) edits.start = timestamp();
    else edits.afterStart = timestamp();
    await chapter(phase, index ? 'Unsent skills are clearly marked.' : 'A verdict for skills never sent.', index ? 'head d9000bc' : 'base badedeb');
    await type('same-name');
    assert.equal(await page.locator('#ai-cluster').textContent(), 'Cluster 2 skills with AI');
    await note('#ai-cluster', 'Only these 2 go to AI');
    await pause(3200);
    await clearCallout(page);
    await point('#ai-cluster'); await page.locator('#ai-cluster').click();
    await page.waitForFunction(() => document.querySelector('#ai-cluster').hasAttribute('aria-busy'));
    await type('');
    await note('#count', '4 visible. Only 2 were sent.', 'left');
    await page.waitForFunction(() => !document.querySelector('#ai-cluster').hasAttribute('aria-busy'));
    const all = await snapshot(index ? 'after-all-skills' : 'before-all-skills', phase);
    assert.equal(all.count, '4 of 4 skills'); assert.equal(all.cards, 1);
    assert.equal(all.unclustered, '');
    if (index) assert.equal(all.unsent, 'Not sent to Claude: 2 skills. Cluster again to include them.');
    else assert.equal(all.unsent, null);
    await pause(2600);
    await clearCallout(page);
    await type('elsewhere');
    await note(index ? '#ai-unsent' : '#ai-no-clusters', index ? 'New: clearly marked as not sent' : 'These skills were never evaluated.', 'left');
    const subset = await snapshot(index ? 'after-only-unsent' : 'before-only-unsent', phase);
    assert.equal(subset.count, '2 of 4 skills'); assert.equal(subset.cards, 0);
    assert.equal(subset.noClustersVisible, !index);
    if (index) assert.equal(subset.unsent, 'Not sent to Claude: 2 skills. Cluster again to include them.');
    await pause(5000);
    await clearCallout(page);
    if (index) {
      await note('#ai-cluster', 'Cluster again to include them');
      await point('#ai-cluster'); await page.locator('#ai-cluster').click();
      await page.waitForFunction(() => document.querySelector('#ai-cluster').hasAttribute('aria-busy'));
      await page.waitForFunction(() => !document.querySelector('#ai-cluster').hasAttribute('aria-busy'));
      await clearCallout(page);
      await note('#ai-unclustered', 'Now this is an evaluated result.', 'left');
      const reevaluated = await snapshot('after-reclustered', phase);
      assert.equal(reevaluated.unsent, ''); assert.equal(reevaluated.unclustered, 'Not in a cluster: 2 skills');
      assert.equal(reevaluated.noClustersVisible, true);
      await pause(4200);
    } else edits.beforeEnd = timestamp();
  }
  await writeFile(join(output, 'observations.json'), JSON.stringify({
    repository: 'diffitask/ai-workshop-2026', pr: 26, presentationRevision: 2,
    base: 'badedeb24d2ec434dc7966510d69fed71bccbf96', head: 'd9000bc0cb769db10675087efabbe3bf417dc851',
    browser: browser.version(), viewport: { width: 1280, height: 720 }, view: 'server',
    transport: 'Replayed GitHub fixture; delayed deterministic model stub, not live Claude',
    observations, moments, edits,
  }, null, 2));
} finally {
  await context.close();
  await video.saveAs(join(output, 'pr-26-demo.webm'));
  await browser.close();
  for (const server of servers) server.child.kill('SIGTERM');
}
console.log(JSON.stringify({ video: join(output, 'pr-26-demo.webm'), observations: observations.length, moments, edits }));
