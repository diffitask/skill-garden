import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { createWebServer } from '../../src/server.ts';
import { replay } from '../../src/core/replay.ts';
import { documentRepository, documentRecording, originalMarkdown } from '../document-fixture.ts';

for (const variant of ['server', 'portable'] as const) {
  test(`${variant} document reader is responsive and copies original Markdown from the keyboard`, { timeout: 20000 }, async (t) => {
    const server = createWebServer({ github: { fetch: replay(documentRecording) } });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => server.close());
    const browser = await chromium.launch({ headless: true });
    t.after(() => browser.close());
    const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    const externalRequests: string[] = [];
    await context.route((url) => url.protocol === 'https:', async (route) => {
      const answer = documentRecording[route.request().url()];
      if (!answer) {
        externalRequests.push(route.request().url());
        await route.abort();
        return;
      }
      await route.fulfill({ status: answer.status, headers: { 'Access-Control-Allow-Origin': '*' },
        contentType: typeof answer.body === 'string' ? 'text/plain' : 'application/json',
        body: typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body) });
    });
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(variant === 'server' ? `http://127.0.0.1:${(server.address() as AddressInfo).port}`
      : new URL('../../skill-atlas.html', import.meta.url).href);
    await page.locator('#repository').fill(documentRepository);
    await page.locator('#scan').click();
    await page.waitForFunction(() => !document.querySelector('#repository-form')!.hasAttribute('aria-busy'));
    await page.locator('#full-document > summary').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#document-content h1').textContent(), 'A readable skill');
    assert.equal(await page.locator('#document-content').isVisible(), true);
    assert.equal(await page.locator('#content').isVisible(), false);
    await page.locator('#document-content a[href="#skill-document-workflow"]').click();
    const anchor = await page.locator('#skill-document-workflow').boundingBox();
    assert.ok(anchor && anchor.y >= 0 && anchor.y < 100, 'Document links navigate to document headings');
    const longCell = 'https://example.com/' + 'a'.repeat(400);
    await page.locator('.document-table tbody td').last().evaluate((element, text) => { element.textContent = text; }, longCell);
    for (const width of [320, 375, 720, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, 'Document/table stay inside the page');
      await page.locator('#read-markdown').focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('#content').isVisible(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, 'Original Markdown wraps within the reader');
      await page.locator('#read-document').click();
      assert.equal(await page.locator('#document-content').isVisible(), true);
    }
    assert.deepEqual(externalRequests, [], 'Markdown images and raw HTML never load external resources');
    assert.equal(await page.locator('#document-content script, #document-content img').count(), 0);
    await page.clock.install();
    await page.locator('#copy-skill').focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#copy-skill')!.textContent === 'Copied!');
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    assert.equal(clipboard.replace(/\r\n/g, '\n'), originalMarkdown.replace(/\r\n/g, '\n'));
    await page.clock.fastForward(2600);
    assert.equal(await page.locator('#copy-skill').textContent(), 'Copy skill');
    assert.equal(await page.locator('#copy-status').textContent(), '');
    await page.locator('#skills button').nth(1).click();
    assert.equal(await page.locator('#full-document').getAttribute('open'), null);
    await page.locator('#full-document > summary').click();
    assert.equal(await page.locator('#document-content h1').textContent(), 'Another skill');
    assert.equal(await page.locator('#read-document').getAttribute('aria-pressed'), 'true');
  });
}
