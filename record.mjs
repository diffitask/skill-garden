// Reproduce: npm ci in both revisions, install Playwright Chromium, then:
// node record.mjs /path/to/base-checkout /path/to/head-checkout [output-dir]
// Uses replay.json for GitHub transport and serve.mjs for a disclosed model stub.
import assert from 'node:assert/strict';
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
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, recordVideo: { dir: output, size: { width: 1280, height: 900 } }, bypassCSP: true });
const page = await context.newPage();
const video = page.video();
let began = Date.now();
const pause = (ms) => page.waitForTimeout(ms);
const timestamp = () => Math.round((Date.now() - began) / 100) / 10;
async function caption(phase, title, explanation) {
  moments.push({ seconds: timestamp(), phase, title, explanation });
  await page.evaluate(({ phase, title, explanation }) => {
    let top = document.getElementById('demo-title');
    if (!top) {
      top = document.createElement('aside'); top.id = 'demo-title'; document.body.append(top);
      const bottom = document.createElement('aside'); bottom.id = 'demo-caption'; document.body.append(bottom);
      const pointer = document.createElement('div'); pointer.id = 'demo-pointer'; document.body.append(pointer);
      const style = document.createElement('style');
      style.textContent = `#demo-title,#demo-caption{position:fixed;left:0;right:0;z-index:2147483646;pointer-events:none;font-family:Arial,sans-serif;box-sizing:border-box}#demo-title{top:0;height:85px;padding:15px 30px;background:#142c3e;color:white;border-bottom:4px solid #68d5bd;display:flex;align-items:center;gap:22px;box-shadow:0 4px 15px #0002}#demo-title b{background:#68d5bd;color:#142c3e;padding:8px 12px;border-radius:6px;font-size:18px;white-space:nowrap}#demo-title span{font-size:24px;font-weight:700}#demo-caption{bottom:0;background:#142c3e;color:white;padding:18px 30px 14px;min-height:107px;border-top:3px solid #68d5bd}#demo-caption strong{display:block;font-size:23px;line-height:1.3}#demo-caption small{display:block;font-size:13px;color:#c7d8e1;margin-top:8px}#demo-pointer{position:fixed;z-index:2147483647;pointer-events:none;width:24px;height:24px;border:3px solid #007c98;border-radius:50%;background:#7ce7fc55;transform:translate(-50%,-50%);display:none}.demo-highlight{outline:3px solid #007c98!important;outline-offset:7px;box-shadow:0 0 0 9px #7ce7fc25!important}`;
      document.head.append(style);
      document.addEventListener('pointermove', (event) => { pointer.style.display = 'block'; pointer.style.left = event.clientX + 'px'; pointer.style.top = event.clientY + 'px'; });
    }
    top.replaceChildren();
    const badge = document.createElement('b'); badge.textContent = phase;
    const heading = document.createElement('span'); heading.textContent = title;
    top.append(badge, heading);
    const bottom = document.getElementById('demo-caption'); bottom.replaceChildren();
    const strong = document.createElement('strong'); strong.textContent = explanation;
    const small = document.createElement('small'); small.textContent = 'PR #26  •  Real Skill Atlas UI + scanner  •  Replayed GitHub data + stubbed model; no live Claude call';
    bottom.append(strong, small);
  }, { phase, title, explanation });
}
async function highlight(selector) {
  await page.evaluate((selector) => {
    document.querySelectorAll('.demo-highlight').forEach((element) => element.classList.remove('demo-highlight'));
    if (selector) document.querySelector(selector)?.classList.add('demo-highlight');
  }, selector);
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
  const y = await page.locator('.results-heading').evaluate((element) => element.getBoundingClientRect().top + window.scrollY - 110);
  await page.evaluate((y) => window.scrollTo(0, y), y);
  await page.mouse.move(1200, 770);
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
try {
  servers.push(await start(baseRoot), await start(headRoot));
  began = Date.now();
  await setup(servers[0].url);
  await caption('PR #26', 'Know which skills the model actually evaluated', 'Same data. Same actions. Before and after this fix.');
  await pause(4000);
  for (const [index, phase] of ['BEFORE · badedeb', 'AFTER · d9000bc'].entries()) {
    if (index) await setup(servers[index].url);
    await caption(phase, '1. Send only the filtered skills', 'Four skills loaded. Filter down to two, then cluster them.');
    await type('same-name');
    assert.equal(await page.locator('#ai-cluster').textContent(), 'Cluster 2 skills with AI');
    await highlight('#ai-cluster');
    await pause(3000);
    await point('#ai-cluster'); await page.locator('#ai-cluster').click();
    await page.waitForFunction(() => document.querySelector('#ai-cluster').hasAttribute('aria-busy'));
    await type('');
    await caption(phase, '2. Clear the filter while the answer is pending', 'All four skills are visible; only two were sent to the model.');
    await page.waitForFunction(() => !document.querySelector('#ai-cluster').hasAttribute('aria-busy'));
    await highlight(index ? '#ai-unsent' : '#ai-clusters');
    const all = await snapshot(index ? 'after-all-skills' : 'before-all-skills', phase);
    assert.equal(all.count, '4 of 4 skills'); assert.equal(all.cards, 1);
    assert.equal(all.unclustered, '');
    if (index) assert.equal(all.unsent, 'Not sent to Claude: 2 skills. Cluster again to include them.');
    else assert.equal(all.unsent, null);
    await pause(5000);
    await caption(phase, '3. Show only the two skills that were never sent', index ? 'The UI now says: Not sent to Claude. Cluster again to include them.' : 'The UI wrongly says: Claude found no clusters among these skills.');
    await type('elsewhere');
    await highlight(index ? '#ai-unsent' : '#ai-no-clusters');
    const subset = await snapshot(index ? 'after-only-unsent' : 'before-only-unsent', phase);
    assert.equal(subset.count, '2 of 4 skills'); assert.equal(subset.cards, 0);
    assert.equal(subset.noClustersVisible, !index);
    if (index) assert.equal(subset.unsent, 'Not sent to Claude: 2 skills. Cluster again to include them.');
    await pause(7000);
    if (index) {
      await caption(phase, '4. Cluster again to evaluate those skills', 'Now these two skills are actually sent. The model can give a result.');
      await highlight('#ai-cluster'); await point('#ai-cluster'); await page.locator('#ai-cluster').click();
      await page.waitForFunction(() => !document.querySelector('#ai-cluster').hasAttribute('aria-busy'));
      const reevaluated = await snapshot('after-reclustered', phase);
      assert.equal(reevaluated.unsent, ''); assert.equal(reevaluated.unclustered, 'Not in a cluster: 2 skills');
      assert.equal(reevaluated.noClustersVisible, true);
      await highlight('#ai-unclustered');
      await caption('RESULT', 'Unsent and evaluated skills are clearly distinguished', 'After a new request, “Not in a cluster” describes a real model result.');
      await pause(6500);
    }
  }
  await writeFile(join(output, 'observations.json'), JSON.stringify({
    repository: 'diffitask/ai-workshop-2026', pr: 26,
    base: 'badedeb24d2ec434dc7966510d69fed71bccbf96', head: 'd9000bc0cb769db10675087efabbe3bf417dc851',
    browser: browser.version(), viewport: { width: 1280, height: 900 }, view: 'server',
    transport: 'Replayed GitHub fixture; delayed deterministic model stub, not live Claude', observations, moments,
  }, null, 2));
} finally {
  await context.close();
  await video.saveAs(join(output, 'pr-26-demo.webm'));
  await browser.close();
  for (const server of servers) server.child.kill('SIGTERM');
}
console.log(JSON.stringify({ video: join(output, 'pr-26-demo.webm'), observations: observations.length, moments }));
