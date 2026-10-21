import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { showChapter, showCallout, clearCallout } from '../../.agents/skills/pr-demo/scripts/annotations.mjs';

test('demo annotations stay near their target, inside the viewport, and leave the product readable and clickable', async (t) => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(`<style>body{margin:0;height:1800px}button{position:absolute;right:24px;top:350px;width:220px;height:50px}</style><button id="target" onclick="this.dataset.clicked='yes'">Actual product text</button>`);
    await showCallout(page, { selector: '#target', text: 'A short note near this control' });
    assert.equal(await page.locator('#air-pr-demo-annotations').locator('#note').evaluate((element: any) => element.ownerDocument.defaultView.getComputedStyle(element).opacity), '1');
    const layout = () => page.evaluate<any>(`(() => {
      const shadow = document.querySelector('#air-pr-demo-annotations').shadowRoot;
      const note = shadow.querySelector('#note').getBoundingClientRect();
      const target = document.querySelector('#target').getBoundingClientRect();
      return { note: note.toJSON(), target: target.toJSON(), shown: !shadow.querySelector('#callout').hidden, viewport: innerWidth };
    })()`);
    const assertPlacement = async () => {
      const { note, target, shown, viewport } = await layout();
      assert.equal(shown, true);
      assert.ok(note.left >= 16 && note.right <= viewport - 16 && note.top >= 16 && note.bottom <= 884);
      assert.ok(note.right <= target.left || note.left >= target.right || note.bottom <= target.top || note.top >= target.bottom, 'Note must not cover the actual product text');
    };
    await assertPlacement();
    await page.locator('#target').click();
    assert.equal(await page.locator('#target').getAttribute('data-clicked'), 'yes');
    await page.evaluate('window.scrollTo(0, 120)');
    await page.waitForTimeout(50);
    await assertPlacement();
    await page.evaluate('window.scrollTo(0, 1000)');
    await page.waitForTimeout(50);
    assert.equal((await layout()).shown, false);
    await page.evaluate('window.scrollTo(0, 120)');
    await page.waitForTimeout(50);
    await assertPlacement();
    await page.setViewportSize({ width: width === 320 ? 375 : 1000, height: 900 });
    await page.waitForTimeout(50);
    await assertPlacement();
    assert.equal(await page.locator('#target').textContent(), 'Actual product text');
    await clearCallout(page);
    assert.equal(await page.locator('#air-pr-demo-annotations').locator('#callout').isVisible(), false);
  }
});

test('demo chapter cards show short safe text, then dismiss completely before interaction', async (t) => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent('<button id="target">Unchanged product</button>');
  let observed = false;
  const chapter = showChapter(page, { label: 'Before', summary: '<img src=x onerror=alert(1)>', detail: 'Fixture + stubbed model', holdMs: 300 });
  await page.waitForFunction(`document.getElementById('air-pr-demo-annotations')?.shadowRoot.querySelector('#chapter').hidden === false`);
  assert.equal(await page.locator('#air-pr-demo-annotations').locator('#chapter-label').textContent(), 'Before');
  assert.equal(await page.locator('#air-pr-demo-annotations').locator('#chapter-summary img').count(), 0);
  observed = await page.locator('#air-pr-demo-annotations').locator('#chapter').isVisible();
  await chapter;
  assert.equal(observed, true);
  assert.equal(await page.locator('#air-pr-demo-annotations').locator('#chapter').isVisible(), false);
  assert.equal(await page.locator('#target').textContent(), 'Unchanged product');
  await showCallout(page, { selector: '#target', text: 'Brief callout' });
  await assert.rejects(showCallout(page, { selector: '#missing', text: 'Must fail' }), /missing or invisible/);
  await page.locator('#target').evaluate((element: any) => { element.hidden = true; });
  await assert.rejects(showCallout(page, { selector: '#target', text: 'Must fail' }), /missing or invisible/);
});
