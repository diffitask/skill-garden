import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { replay, type Recording } from '../../src/core/replay.ts';
import { createWebServer } from '../../src/server.ts';

const repository = 'https://github.com/owner/mobile';
const commit = 'mobile-commit';
const files = ['.agents/skills/build-one/SKILL.md', '.agents/skills/build-two/SKILL.md'];
const recording: Recording = {
  'https://api.github.com/repos/owner/mobile': { status: 200, body: { full_name: 'owner/mobile', default_branch: 'main' } },
  'https://api.github.com/repos/owner/mobile/commits/main': { status: 200, body: { sha: commit } },
  [`https://api.github.com/repos/owner/mobile/git/trees/${commit}?recursive=1`]: {
    status: 200, body: { truncated: false, tree: files.map((path) => ({ path, type: 'blob', mode: '100644', sha: 'file' })) },
  },
};
for (const path of files) {
  recording[`https://raw.githubusercontent.com/owner/mobile/${commit}/${path}`] = {
    status: 200, body: `---\nname: ${path.split('/').at(-2)}\ndescription: Builds Gradle projects and compiles sources.\n---\n# Build\n`,
  };
}

type Layout = { viewport: number; document: number; panelLeft: number; panelRight: number; selectLeft: number; selectRight: number };

for (const variant of ['server', 'portable'] as const) {
  test(`${variant} cluster controls fit narrow and desktop viewports without horizontal scrolling`, { timeout: 15000 }, async (t) => {
    const server = createWebServer({ github: { fetch: replay(recording) } });
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
    await page.locator('#repository').fill(repository);
    await page.locator('#scan').click();
    await page.waitForFunction("!document.querySelector('#repository-form').hasAttribute('aria-busy')");
    assert.equal(await page.locator('#results').isVisible(), true, await page.locator('#error-message').textContent() ?? 'Scan failed');
    assert.equal(await page.locator('#skills button').count(), 2);
    for (const width of [320, 375, 720, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const level of ['Loose', 'Balanced', 'Strict']) {
        await page.locator('#cluster-level').selectOption(level);
        const layout = await page.evaluate<Layout>(`(() => {
          const select = document.querySelector('#cluster-level').getBoundingClientRect();
          const panel = document.querySelector('.cluster-panel').getBoundingClientRect();
          return { viewport: innerWidth, document: document.documentElement.scrollWidth,
            panelLeft: panel.left, panelRight: panel.right, selectLeft: select.left, selectRight: select.right };
        })()`);
        assert.ok(layout.selectLeft >= layout.panelLeft && layout.selectRight <= layout.panelRight,
          `${width}px ${level}: selector must stay inside its panel: ${JSON.stringify(layout)}`);
        assert.equal(layout.document, layout.viewport, `${width}px ${level}: page must not scroll horizontally`);
        assert.equal(await page.locator('#skills button').count(), 2, 'Changing level retains the skills');
      }
    }
  });
}
