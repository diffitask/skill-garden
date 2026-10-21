import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { replay, type Recording } from '../../src/core/replay.ts';
import { createWebServer } from '../../src/server.ts';

const repository = 'https://github.com/owner/mobile';
const commit = 'mobile-commit';
const files = [`.agents/skills/build-${'long-name-'.repeat(8)}one/SKILL.md`, '.agents/skills/build-two/SKILL.md'];
const recording: Recording = {
  'https://api.github.com/repos/owner/mobile': { status: 200, body: { full_name: 'owner/mobile', default_branch: 'main' } },
  'https://api.github.com/repos/owner/mobile/commits/main': { status: 200, body: { sha: commit } },
  [`https://api.github.com/repos/owner/mobile/git/trees/${commit}?recursive=1`]: {
    status: 200, body: { truncated: false, tree: files.map((path) => ({ path, type: 'blob', mode: '100644', sha: 'file' })) },
  },
};
for (const path of files) {
  recording[`https://raw.githubusercontent.com/owner/mobile/${commit}/${path}`] = {
    status: 200, body: `---\nname: ${path.split('/').at(-2)}\ndescription: Builds Gradle projects and compiles sources. Runs project checks. Use when preparing a build. Requires Java 21.\n---\n# Build\nOriginal build instructions.\n`,
  };
}

type Layout = { viewport: number; document: number; panelLeft: number; panelRight: number; selectLeft: number; selectRight: number };

for (const variant of ['server', 'portable'] as const) {
  test(`${variant} field guide disclosures, reader and cluster controls work from mobile to desktop`, { timeout: 20000 }, async (t) => {
    let finishAi!: () => void;
    t.after(() => finishAi?.());
    let startAi!: () => void;
    const aiStarted = new Promise<void>((started) => { startAi = started; });
    const server = createWebServer({ github: { fetch: replay(recording) }, pairingCode: 'browser-pair-code',
      ask: async () => new Promise((resolve) => {
        finishAi = () => resolve({ clusters: [{ label: 'Build tools', skills: ['s1', 's2'] }] });
        startAi();
      }),
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => server.close());
    const browser = await chromium.launch({ headless: true });
    t.after(() => browser.close());
    const context = await browser.newContext();
    // Replay only GitHub transport. Real scanner, scripts, styles and browser layout run unchanged.
    await context.route((url) => url.protocol === 'https:', async (route) => {
      const answer = recording[route.request().url()];
      assert.ok(answer, `Unexpected external request: ${route.request().url()}`);
      await route.fulfill({ status: answer.status, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: typeof answer.body === 'string' ? 'text/plain' : 'application/json',
        body: typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body) });
    });
    const page = await context.newPage();
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto(variant === 'server'
      ? `http://127.0.0.1:${(server.address() as AddressInfo).port}`
      : new URL('../../skill-atlas.html', import.meta.url).href);
    const flowers = page.locator('.background-flowers');
    assert.equal(await flowers.getAttribute('aria-hidden'), 'true');
    assert.equal(await flowers.getAttribute('focusable'), 'false');
    const decoration = await flowers.evaluate((element) => {
      const style = getComputedStyle(element);
      return { position: style.position, pointerEvents: style.pointerEvents, opacity: Number(style.opacity),
        zIndex: Number(style.zIndex), animation: style.animationName, flowers: element.querySelectorAll('use').length };
    });
    assert.equal(decoration.position, 'fixed');
    assert.equal(decoration.pointerEvents, 'none');
    assert.ok(decoration.opacity > 0 && decoration.opacity < .5, 'Flowers stay softly tinted');
    assert.ok(decoration.zIndex < 0, 'Flowers sit behind the content');
    assert.equal(decoration.animation, 'none');
    assert.ok(decoration.flowers > 0, 'Both views embed the floral artwork');
    assert.equal(await page.locator('#empty-guide').isVisible(), true);
    assert.equal(await page.locator('#repository-form .section-heading h2').textContent(), 'Where shall we explore?');
    await page.locator('#repository').fill(repository);
    await page.locator('#scan').click();
    await page.waitForFunction(() => !document.querySelector('#repository-form')!.hasAttribute('aria-busy'));
    assert.equal(await page.locator('#results').isVisible(), true, await page.locator('#error-message').textContent() ?? 'Scan failed');
    const resultBounds = await page.locator('#results').boundingBox();
    assert.ok(resultBounds && resultBounds.y >= 0 && resultBounds.y < 150, 'A scan brings the results into view');
    assert.equal(await page.locator('#skills button').count(), 2);
    assert.equal(await page.locator('#empty-guide').isVisible(), false, 'First-visit guidance leaves the results uncluttered');
    assert.equal(await page.locator('.library-sidebar #filter-skills').count(), 1, 'Filter stays beside the directory');
    const selected = await page.locator('#skill-name').textContent();
    const clusters = page.locator('#cluster-disclosure');
    await clusters.locator('> summary').focus();
    await page.keyboard.press('Enter');
    assert.equal(await clusters.getAttribute('open'), null);
    await page.locator('#filter-skills').fill('build');
    assert.equal(await clusters.getAttribute('open'), null, 'Filtering preserves the collapsed connections');
    assert.equal(await page.locator('#skill-name').textContent(), selected);
    await page.locator('#filter-skills').fill('no-such-skill');
    assert.equal(await page.locator('#no-matches').isVisible(), true);
    assert.equal(await page.locator('#detail').isVisible(), false);
    await page.locator('#filter-skills').fill('');
    await clusters.locator('> summary').focus();
    await page.keyboard.press('Enter');
    assert.notEqual(await clusters.getAttribute('open'), null);
    await page.locator('#cluster-list button').first().click();
    assert.equal(await page.locator('#skill-name').evaluate((element) => element === document.activeElement), true);
    const reader = await page.locator('#detail').boundingBox();
    assert.ok(reader && reader.y >= 0 && reader.y < 150, 'Selecting a cluster member brings its instructions into view');
    assert.equal(await page.locator('.summary-block h3 .icon[aria-hidden="true"]').count(), 4);
    await page.locator('#full-document > summary').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#document-content').isVisible(), true);
    assert.match(await page.locator('#document-content').textContent() ?? '', /Original build instructions/);
    if (variant === 'portable') {
      assert.equal(await page.locator('#github-token').isVisible(), true);
      assert.equal(await page.locator('#ai-helper-url').isVisible(), false);
      await page.locator('#ai-setup > summary').click();
      await page.locator('#ai-helper-url').fill('http://127.0.0.1:3456');
      await page.locator('#ai-pairing-code').fill('test-pairing-code');
      await page.locator('#ai-setup > summary').click();
      assert.equal(await page.locator('#ai-pairing-code').isVisible(), false);
      await page.locator('#ai-setup > summary').click();
      assert.equal(await page.locator('#ai-helper-url').inputValue(), 'http://127.0.0.1:3456');
      assert.equal(await page.locator('#ai-pairing-code').inputValue(), 'test-pairing-code');
    }
    for (const width of [320, 375, 720, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const level of ['Loose', 'Balanced', 'Strict']) {
        await page.locator('#cluster-level').selectOption(level);
        const layout = await page.evaluate<Layout>(() => {
          const select = document.querySelector('#cluster-level')!.getBoundingClientRect();
          const panel = document.querySelector('.cluster-panel')!.getBoundingClientRect();
          return { viewport: innerWidth, document: document.documentElement.scrollWidth,
            panelLeft: panel.left, panelRight: panel.right, selectLeft: select.left, selectRight: select.right };
        });
        assert.ok(layout.selectLeft >= layout.panelLeft && layout.selectRight <= layout.panelRight,
          `${width}px ${level}: selector must stay inside its panel: ${JSON.stringify(layout)}`);
        assert.equal(layout.document, layout.viewport, `${width}px ${level}: page must not scroll horizontally`);
        assert.equal(await page.locator('#skills button').count(), 2, 'Changing level retains the skills');
      }
    }
    await clusters.locator('> summary').click();
    await page.locator('#scan').click();
    await page.waitForFunction(() => !document.querySelector('#repository-form')!.hasAttribute('aria-busy'));
    assert.notEqual(await clusters.getAttribute('open'), null, 'A new scan starts with connections expanded');
    await page.locator('a[href="#skill-library"]').click();
    const directory = await page.locator('#skill-library').boundingBox();
    assert.ok(directory && directory.y >= 0 && directory.y < 150, 'Browse skills jumps directly to the reader section');
    if (variant === 'portable') {
      await page.locator('#ai-helper-url').fill(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
      await page.locator('#ai-pairing-code').fill('browser-pair-code');
    }
    await page.clock.install();
    await page.locator('#ai-cluster').click();
    await aiStarted;
    assert.equal(await page.locator('#ai-cluster').textContent(), 'Clustering…');
    assert.equal(await page.locator('#ai-cluster').isDisabled(), true);
    assert.equal(await page.locator('#ai-progress').isVisible(), true);
    assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuenow'), null, 'Progress is indeterminate');
    for (const width of [320, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, 'Pending feedback fits the viewport');
    }
    assert.notEqual(await page.locator('.ai-progress-track > span').evaluate((element) => getComputedStyle(element).animationName), 'none');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator('.ai-progress-track > span').evaluate((element) => getComputedStyle(element).animationName), 'none');
    await page.clock.fastForward(31000);
    assert.equal(await page.locator('#ai-elapsed').textContent(), '0:31 elapsed');
    assert.match(await page.locator('#ai-progress-note').textContent() ?? '', /Still waiting for AI/);
    await page.locator('#filter-skills').fill('build-two');
    assert.equal(await page.locator('#ai-status').textContent(), 'Clustering 2 skills…');
    assert.equal(await page.locator('#ai-elapsed').textContent(), '0:31 elapsed');
    await page.clock.resume();
    finishAi();
    await page.waitForFunction(() => !document.querySelector('#ai-cluster')!.hasAttribute('aria-busy'));
    assert.equal(await page.locator('#ai-progress').isVisible(), false);
    assert.equal(await page.locator('#ai-elapsed').isVisible(), false);
    assert.match(await page.locator('#ai-status').textContent() ?? '', /clustered 2 skills/);
  });
}
