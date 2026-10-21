import assert from 'node:assert/strict';
import { test } from 'node:test';
import { flowerMarkup } from '../src/web/flowers.js';

test('flower identifiers are stable, varied, self-contained, and never interpolate source text', () => {
  const ids = Array.from({ length: 100 }, (_, i) => `owner/repo:skills/skill-${i}/SKILL.md`);
  const flowers = ids.map(flowerMarkup);
  assert.deepEqual(ids.map(flowerMarkup), flowers);
  assert.equal(new Set(flowers).size, ids.length);
  for (const seed of ['<script>alert(1)</script>', '"><img src=x onerror=alert(1)>', '🌸', '', 'é'.repeat(1000)]) {
    const markup = flowerMarkup(seed);
    assert.match(markup, /aria-hidden="true" focusable="false"/);
    assert.doesNotMatch(markup, /<script|<img|onerror|href=|style=|<animate/);
    assert.match(markup, /^<svg[\s\S]*<\/svg>$/);
  }
});
