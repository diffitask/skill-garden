import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';
import { portableHtml } from '../scripts/build-web.ts';
import { createWebServer } from '../src/server.ts';
import { replay } from '../src/core/replay.ts';
import type { Fetch } from '../src/core/github.ts';
import { API, ORG, LIST, doc, entry, organizationFixture } from './organization-fixture.ts';

for (const variant of ['server', 'portable'] as const) {
  test(`${variant} organization submission, progress, attribution, groups, selection, partial results, empty states, errors, and retry`, async (t) => {
    let recording = organizationFixture();
    const requests: { url: string; authorization?: string }[] = [];
    let release: (() => void) | undefined;
    let blocked = false;
    const transport: Fetch = async (url, init) => {
      requests.push({ url, authorization: init?.headers?.Authorization });
      if (blocked) {
        blocked = false;
        await new Promise<void>((resolve) => { release = resolve; });
      }
      return replay(recording)(url, init);
    };
    let base = 'file:///skill-atlas.html';
    if (variant === 'server') {
      const server = createWebServer({ github: { fetch: transport, token: 'server-test-token' } });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      t.after(() => server.close());
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    }
    const errors: Error[] = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', (error) => errors.push(error));
    const options = {
      runScripts: 'dangerously' as const, virtualConsole,
      beforeParse(window: JSDOM['window']) {
        Object.assign(window, { TextDecoder, TextEncoder });
        window.fetch = variant === 'server'
          ? (url, init) => fetch(new URL(String(url), base), init)
          : (url, init) => transport(String(url), init as { headers?: Record<string, string> });
      },
    };
    const dom = variant === 'server'
      ? await JSDOM.fromURL(base, { ...options, resources: 'usable' })
      : new JSDOM(await portableHtml(), { ...options, url: base });
    t.after(() => dom.window.close());
    if (variant === 'server') await new Promise((resolve) => dom.window.addEventListener('load', resolve, { once: true }));
    const document = dom.window.document;
    const el = (selector: string) => document.querySelector<HTMLElement>(selector)!;
    const input = document.querySelector<HTMLInputElement>('#repository')!;
    const token = document.querySelector<HTMLInputElement>('#github-token')!;
    const button = document.querySelector<HTMLButtonElement>('#scan')!;
    const form = document.querySelector('form')!;
    assert.match(document.querySelector('label[for="repository"]')!.textContent!, /repository or organization/);
    if (variant === 'portable') token.value = 'browser-test-token';
    const dispatch = () => form.dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
    const finish = async () => {
      const deadline = Date.now() + 5000;
      while (form.hasAttribute('aria-busy')) {
        if (Date.now() > deadline) throw new Error('Organization web scan did not finish');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(button.disabled, false);
    };
    const submit = async (url = ORG) => { input.value = url; dispatch(); await finish(); };
    await submit();
    assert.equal(el('#scan-error').hidden, true, el('#error-message').textContent!);
    assert.match(el('#status').textContent!, /Partial results for Example/);
    if (variant === 'portable') {
      assert.equal(el('#scan-progress').hidden, false);
      assert.match(el('#progress-counts').textContent!, /4 \/ 4 repositories processed · 4 skills found/);
      assert.match(el('#progress-stage').textContent!, /finished with partial results/);
      const log = el('#progress-log').textContent!;
      assert.match(log, /page 1, 1 public repositories/);
      assert.match(log, /page 2, 4 public repositories/);
      assert.match(log, /Listing files: Example\/alpha/);
      assert.match(log, /Reading skill document/);
      assert.match(log, /1 scanned, 1 failed, 1 skipped/);
    }
    assert.match(el('#scan-summary').textContent!, /Example · 4 skills.*4 discovered, 2 successfully scanned, 1 failed, 1 skipped/);
    assert.match(el('#warnings').textContent!, /Example\/empty:.*empty; skipped/);
    assert.match(el('#warnings').textContent!, /Example\/failed:.*not found/);
    assert.deepEqual([...document.querySelectorAll('#skills h3')].map((h) => h.textContent), ['Example/alpha · 2 skills', 'Example/zebra · 2 skills']);
    assert.deepEqual([...document.querySelectorAll('#skills h4')].map((h) => h.textContent), ["In agents' folders · 1 skill", 'Elsewhere · 1 skill', "In agents' folders · 1 skill", 'Elsewhere · 1 skill']);
    assert.equal(el('#skill-name').textContent, 'same-name', 'Agent skills appear first in organization groups');
    assert.equal(el('#skill-repository').textContent, 'Example/alpha');
    assert.equal(el('#content').textContent, doc('alpha'));
    assert.equal(el('#source').getAttribute('href'), 'https://github.com/Example/alpha/blob/alpha-commit/.agents/skills/shared/SKILL.md');
    assert.equal(document.querySelectorAll('#content script').length, 0);
    assert.equal(document.querySelectorAll('#skills button').length, 4, 'Copies and test data are not additional skills');
    assert.match(el('#skills').textContent!, /also in .claude\/skills\/shared\/SKILL.md/);
    const zebra = [...document.querySelectorAll<HTMLButtonElement>('#skills button')].find((b) => b.textContent!.includes('Example/zebra') && b.querySelector('strong')!.textContent === 'same-name')!;
    document.querySelector<HTMLDetailsElement>('#full-document')!.open = true;
    zebra.click();
    assert.equal(el('#skill-repository').textContent, 'Example/zebra');
    assert.equal(el('#content').textContent, doc('zebra'));
    assert.equal(document.querySelector<HTMLDetailsElement>('#full-document')!.open, false);
    assert.match(el('#source').getAttribute('href')!, /Example\/zebra\/blob\/zebra-commit/);
    assert.equal(document.querySelectorAll('#skills button[aria-current]').length, 1);
    assert.equal(zebra.getAttribute('aria-current'), 'true');
    assert.equal(document.querySelectorAll('#test-data a').length, 2);
    assert.match(document.querySelector('#test-data a')!.getAttribute('href')!, /Example\/alpha\/blob\/alpha-commit\/tests\/fixtures/);
    assert.ok(!requests.some(({ url }) => url.includes('/private') || (url.startsWith('https://raw.') && /fixtures|claude/.test(url))));
    const expectedToken = variant === 'server' ? 'server-test-token' : 'browser-test-token';
    assert.ok(requests.filter(({ url }) => url.startsWith(API)).every(({ authorization }) => authorization === `Bearer ${expectedToken}`));
    assert.ok(requests.filter(({ url }) => url.startsWith('https://raw.')).every(({ authorization }) => !authorization));
    assert.ok(!requests.some(({ url }) => url.includes('/search/code')), 'Organization tree discovery includes forks and archives without search indexing');
    assert.ok(!dom.serialize().includes(expectedToken));
    assert.ok(!requests.some(({ url }) => url.includes(expectedToken)));
    if (variant === 'server') assert.ok(!dom.serialize().includes('server-test-token'));

    blocked = true;
    input.value = ORG;
    const before = requests.length;
    dispatch();
    assert.equal(form.getAttribute('aria-busy'), 'true');
    assert.equal(button.disabled, true);
    assert.match(el('#status').textContent!, /Scanning/);
    assert.equal(el('#results').hidden, true);
    assert.equal(el('#skills').children.length, 0);
    assert.equal(el('#test-data').children.length, 0);
    assert.equal(el('#scan-summary').textContent, '');
    dispatch(); // Even a programmatic duplicate submission must be ignored.
    const deadline = Date.now() + 5000;
    while (!release) {
      if (Date.now() > deadline) throw new Error('Scan did not start');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(requests.length, before + 1);
    if (variant === 'portable') {
      assert.equal(el('#progress-bar').hasAttribute('value'), false);
      assert.match(el('#progress-counts').textContent!, /total not known/);
      assert.doesNotMatch(el('#progress-log').textContent!, /Processed/);
      await new Promise((resolve) => setTimeout(resolve, 1100));
      assert.match(el('#progress-time').textContent!, /Elapsed: 1s · Last activity: 1s/);
    }
    release();
    await finish();

    recording[LIST] = { status: 200, body: [] };
    await submit();
    assert.equal(el('#empty').hidden, false);
    assert.match(el('#empty-message').textContent!, /no public repositories/);
    assert.match(el('#scan-summary').textContent!, /0 discovered, 0 successfully scanned/);
    assert.match(el('#status').textContent!, /Scanned organization Example/);
    assert.equal(el('#warnings').hidden, true);
    assert.equal(el('#results').hidden, true);

    recording[LIST] = { status: 200, body: [entry('alpha')] };
    recording[`${API}/repos/Example/alpha/git/trees/alpha-commit?recursive=1`] = { status: 200, body: { truncated: false, tree: [] } };
    recording[`${API}/search/code?q=filename:SKILL.md+repo:Example/alpha&per_page=100&page=1`] = { status: 200, body: { total_count: 0, items: [] } };
    await submit();
    assert.match(el('#empty-message').textContent!, /no skills in its public repositories/);
    assert.match(el('#scan-summary').textContent!, /1 successfully scanned/);
    assert.match(el('#status').textContent!, /Scanned organization/);

    recording = organizationFixture();
    recording[LIST] = { status: 200, body: [entry('failed')] };
    await submit();
    assert.match(el('#empty-title').textContent!, /No skills available from completed scans/);
    assert.match(el('#status').textContent!, /Partial results/);
    assert.match(el('#scan-summary').textContent!, /0 successfully scanned, 1 failed/);

    for (const kind of ['user', 'missing', 'limited', 'listing-failed', 'invalid']) {
      recording = organizationFixture();
      if (kind === 'user') recording[`${API}/users/Example`] = { status: 200, body: { login: 'Example', type: 'User' } };
      if (kind === 'missing') recording[`${API}/users/Example`] = { status: 404, body: { message: 'Not Found' } };
      if (kind === 'limited') recording[`${API}/users/Example`] = { status: 429, body: {} };
      if (kind === 'listing-failed') recording[LIST] = { status: 500, body: {} };
      await submit(kind === 'invalid' ? 'https://github.com/Example/repo/extra' : ORG);
      assert.equal(el('#scan-error').hidden, false);
      if (variant === 'portable') {
        assert.match(el('#progress-stage').textContent!, /Scan stopped/);
        assert.doesNotMatch(el('#progress-log').textContent!, /browser-test-token|server-test-token/);
      }
      assert.equal(document.activeElement, el('#scan-error'));
      assert.equal(el('#results').hidden, true);
      assert.equal(el('#scan-summary').textContent, '');
      assert.equal(el('#empty').hidden, true, 'Discovery errors must not show a successful empty state');
      const message = el('#error-message').textContent!;
      assert.match(message, kind === 'user' ? /requires an organization/ : kind === 'missing' ? /Organization not found/
        : kind === 'limited' ? (variant === 'portable' ? /limited requests for this token.*Wait/ : /restart the server with GITHUB_TOKEN/)
        : kind === 'listing-failed' ? /GitHub answered 500/ : /GitHub repository URL/);
    }

    recording = organizationFixture();
    recording[LIST] = { status: 200, body: [entry('alpha'), entry('zebra')] };
    recording[`${API}/repos/Example/zebra`] = { status: 403, body: { message: 'API rate limit exceeded' } };
    await submit();
    assert.match(el('#status').textContent!, /Partial results/);
    assert.match(el('#warnings').textContent!, /Example\/zebra: GitHub has temporarily limited requests/);
    assert.match(el('#warnings').textContent!, variant === 'portable' ? /limited requests for this token.*Wait/ : /restart the server with GITHUB_TOKEN/);
    if (variant === 'portable') {
      assert.doesNotMatch(el('#warnings').textContent!, /GITHUB_TOKEN|browser-test-token/);
      token.value = '';
      await submit();
      assert.match(el('#warnings').textContent!, /add a GitHub token/);
    }
    recording = organizationFixture();
    recording[LIST] = { status: 200, body: [entry('alpha'), entry('zebra')] };
    document.querySelector<HTMLButtonElement>('#retry')!.click();
    await finish();
    assert.equal(el('#scan-error').hidden, true);
    assert.equal(el('#warnings').hidden, true);
    assert.equal(el('#results').hidden, false);
    assert.match(el('#status').textContent!, /^Scanned organization Example/);
    assert.deepEqual(errors, []);
  });
}
