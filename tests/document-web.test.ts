import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';
import { portableHtml } from '../scripts/build-web.ts';
import { createWebServer } from '../src/server.ts';
import { replay } from '../src/core/replay.ts';
import { documentRepository, documentRecording, originalMarkdown } from './document-fixture.ts';

async function until(condition: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

for (const variant of ['server', 'portable'] as const) {
  test(`${variant} formats safe documents, retains original Markdown, and copies with feedback and fallbacks`, async (t) => {
    const server = createWebServer({ github: { fetch: replay(documentRecording) } });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => server.close());
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    let copyMode: 'modern' | 'legacy' | 'denied' | 'pending' = 'modern';
    let copied = '';
    let finishCopy!: () => void;
    const requests: string[] = [];
    const errors: Error[] = [];
    const console = new VirtualConsole();
    console.on('jsdomError', (error) => errors.push(error));
    const options = {
      runScripts: 'dangerously' as const, resources: 'usable' as const, virtualConsole: console,
      beforeParse(window: JSDOM['window']) {
        Object.assign(window, { TextEncoder, TextDecoder });
        const github = replay(documentRecording);
        window.fetch = (input, init) => {
          requests.push(String(input));
          return variant === 'server' ? fetch(new URL(String(input), base), init)
            : github(String(input), init as { headers?: Record<string, string> });
        };
        Object.defineProperty(window.navigator, 'clipboard', { value: {
          writeText: async (text: string) => {
            if (copyMode === 'pending') return new Promise<void>((resolve) => { finishCopy = resolve; });
            if (copyMode !== 'modern') throw new Error('Clipboard denied');
            copied = text;
          },
        } });
        window.document.execCommand = () => {
          if (copyMode === 'denied') return false;
          copied = window.document.querySelector('textarea')!.value;
          return true;
        };
      },
    };
    const dom = variant === 'server' ? await JSDOM.fromURL(base, options)
      : new JSDOM(await portableHtml(), { ...options, url: 'file:///skill-garden.html' });
    t.after(() => dom.window.close());
    if (dom.window.document.readyState !== 'complete') await new Promise((resolve) => dom.window.addEventListener('load', resolve, { once: true }));
    const document = dom.window.document;
    const el = (id: string) => document.querySelector<HTMLElement>(id)!;
    const button = (id: string) => document.querySelector<HTMLButtonElement>(id)!;
    document.querySelector<HTMLInputElement>('#repository')!.value = documentRepository;
    document.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
    await until(() => !el('#repository-form').hasAttribute('aria-busy'));
    assert.equal(el('#results').hidden, false, el('#error-message').textContent!);
    assert.equal(document.querySelector<HTMLDetailsElement>('#full-document')!.open, false);
    button('#full-document summary').click();
    assert.equal(el('#document-content').hidden, false);
    assert.equal(el('#content').hidden, true);
    assert.equal(el('#content').textContent, originalMarkdown);
    assert.equal(el('#document-content h1').textContent, 'A readable skill');
    assert.equal(el('#document-content strong').textContent, 'carefully');
    assert.equal(el('#document-content em').textContent, 'deliberately');
    assert.equal(el('#document-content ol li ul li').textContent, 'Check the requirements.');
    assert.match(el('#document-content blockquote').textContent!, /Keep the original wording/);
    assert.match(el('#document-content pre code').textContent!, /<script>literal code<\/script>/);
    assert.equal(el('#document-content .document-table table th').textContent, 'Step');
    assert.equal(document.querySelector<HTMLDetailsElement>('.document-metadata')!.open, false);
    assert.match(el('.document-metadata pre').textContent!, /name: a-guide/);
    const links = [...document.querySelectorAll<HTMLAnchorElement>('#document-content a')];
    assert.equal(links.find((a) => a.textContent === 'Reference')!.href, 'https://github.com/owner/reader/blob/reader-commit/skills/a-guide/references/guide.md');
    assert.equal(links.find((a) => a.textContent === 'Jump')!.getAttribute('href'), '#skill-document-workflow');
    assert.ok(document.getElementById('skill-document-workflow-1'));
    assert.equal(document.querySelectorAll('#document-content script, #document-content img, #document-content style, #document-content svg, #document-content form').length, 0);
    assert.equal(document.querySelectorAll('form#repository-form').length, 1);
    assert.equal(document.querySelectorAll('#document-content a[href^="javascript:"], #document-content a[href^="data:"]').length, 0);
    assert.equal((dom.window as unknown as { documentScriptRan?: boolean }).documentScriptRan, undefined);
    const reads = requests.length;
    button('#read-markdown').click();
    assert.equal(el('#content').hidden, false);
    assert.equal(el('#document-content').hidden, true);
    assert.equal(button('#read-markdown').getAttribute('aria-pressed'), 'true');
    button('#read-document').click();
    assert.equal(el('#content').hidden, true);
    assert.equal(button('#read-document').getAttribute('aria-pressed'), 'true');
    button('#copy-skill').click();
    await until(() => button('#copy-skill').textContent === 'Copied!');
    assert.equal(copied, originalMarkdown, 'Clipboard API receives the unmodified source, including CRLF and front matter');
    assert.equal(el('#copy-status').getAttribute('role'), 'status');
    assert.equal(el('#copy-status').textContent, 'Original Markdown copied.');
    copyMode = 'legacy';
    button('#copy-skill').focus();
    button('#copy-skill').click();
    await until(() => !button('#copy-skill').disabled);
    assert.equal(copied, originalMarkdown.replace(/\r\n/g, '\n'), 'Textarea fallback retains the complete source with browser-normalized line endings');
    assert.equal(document.querySelector('textarea'), null);
    assert.equal(document.activeElement, button('#copy-skill'));
    copyMode = 'denied';
    button('#copy-skill').click();
    await until(() => /Copy unavailable/.test(el('#copy-status').textContent!));
    assert.equal(el('#content').hidden, false);
    assert.equal(dom.window.getSelection()!.toString(), originalMarkdown);
    assert.equal(document.querySelector('textarea'), null);
    copyMode = 'pending';
    button('#copy-skill').click();
    assert.equal(button('#copy-skill').disabled, true);
    document.querySelectorAll<HTMLButtonElement>('#skills button')[1]!.click();
    finishCopy();
    await until(() => !button('#copy-skill').disabled);
    assert.equal(button('#copy-skill').textContent, 'Copy skill');
    assert.equal(el('#copy-status').textContent, '');
    assert.equal(el('#document-content').hidden, false);
    assert.equal(document.querySelector<HTMLDetailsElement>('#full-document')!.open, false);
    assert.equal(el('#document-content h1').textContent, 'Another skill');
    assert.equal(requests.length, reads, 'Reading, changing views and copying never fetch more files');
    const filter = document.querySelector<HTMLInputElement>('#filter-skills')!;
    filter.value = 'no-such-skill';
    filter.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    assert.equal(el('#document-content').textContent, '');
    assert.equal(el('#content').textContent, '');
    assert.equal(button('#copy-skill').disabled, true);
    assert.deepEqual(errors, []);
  });
}
