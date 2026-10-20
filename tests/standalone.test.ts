import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';
import { portableHtml } from '../scripts/build-web.ts';
import { replay } from '../src/core/replay.ts';

const content = '---\nname: demo\ndescription: A portable skill.\n---\n# Instructions\n<script>throw new Error("unsafe")</script>';

test('portable HTML opens as a file and scans GitHub without a local server or external assets', async (t) => {
  const html = await portableHtml();
  assert.equal(await readFile(new URL('../skill-atlas.html', import.meta.url), 'utf8'), html, 'Regenerate the portable page after scanner changes');
  const requests: string[] = [];
  let mode: 'allowed' | 'limited' | 'token-limited' = 'allowed';
  const authorizations: { url: string; authorization?: string }[] = [];
  const github = replay({
    'https://api.github.com/repos/owner/repo': { status: 200, body: { full_name: 'owner/repo', default_branch: 'main' } },
    'https://api.github.com/repos/owner/repo/commits/main': { status: 200, body: { sha: 'abc123' } },
    'https://api.github.com/repos/owner/repo/git/trees/abc123?recursive=1': { status: 200, body: {
      truncated: false, tree: [
        { path: '.agents/skills/demo/SKILL.md', type: 'blob', mode: '100644', sha: 'file' },
        { path: '.claude/skills/demo/SKILL.md', type: 'blob', mode: '100644', sha: 'copy' },
        { path: 'tests/data/.claude/skills/sample/SKILL.md', type: 'blob', mode: '100644', sha: 'test' },
      ],
    } },
    'https://raw.githubusercontent.com/owner/repo/abc123/.agents/skills/demo/SKILL.md': { status: 200, body: content },
  });
  const errors: Error[] = [];
  const console = new VirtualConsole();
  console.on('jsdomError', (error) => errors.push(error));
  const dom = new JSDOM(html, {
    url: 'file:///skill-atlas.html', runScripts: 'dangerously', virtualConsole: console,
    beforeParse(window) {
      Object.assign(window, { TextDecoder, TextEncoder });
      window.fetch = async (input, init) => {
        requests.push(String(input));
        const authorization = new Headers(init?.headers).get('Authorization') ?? undefined;
        authorizations.push({ url: String(input), authorization });
        if (authorization === 'Bearer invalid-token') {
          return new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 });
        }
        if (String(input).startsWith('https://api.github.com/') && (mode === 'token-limited' || (mode === 'limited' && !authorization))) {
          return new Response(JSON.stringify({ message: 'API rate limit exceeded' }), { status: 403 });
        }
        return github(String(input), init as { headers?: Record<string, string> });
      };
    },
  });
  t.after(() => dom.window.close());
  const document = dom.window.document;
  assert.equal(document.querySelectorAll('script[src],link[rel="stylesheet"]').length, 0);
  const input = document.querySelector<HTMLInputElement>('#repository')!;
  const form = document.querySelector('form')!;
  const submit = async (retry = false) => {
    if (retry) document.querySelector<HTMLButtonElement>('#retry')!.click();
    else form.dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
    const deadline = Date.now() + 5000;
    while (form.hasAttribute('aria-busy')) {
      if (Date.now() > deadline) throw new Error('Portable scan did not finish');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  input.value = 'https://github.com/owner/repo';
  await submit();
  assert.equal(document.querySelector('#skill-name')!.textContent, 'demo');
  assert.equal(document.querySelector('#content')!.textContent, content);
  assert.equal(document.querySelectorAll('#content script').length, 0);
  assert.equal(document.querySelector('#source')!.getAttribute('href'), 'https://github.com/owner/repo/blob/abc123/.agents/skills/demo/SKILL.md');
  assert.equal(document.querySelectorAll('#skills button').length, 1, 'Copies are one skill and test data is excluded');
  assert.equal(requests.length, 4, 'Do not read copies or test data');
  assert.ok(requests.every((url) => url.startsWith('https://')));
  mode = 'limited';
  await submit();
  const errorPanel = document.querySelector<HTMLElement>('#scan-error')!;
  const errorMessage = document.querySelector('#error-message')!;
  const tokenInput = document.querySelector<HTMLInputElement>('#github-token')!;
  const access = document.querySelector<HTMLDetailsElement>('#github-access')!;
  const addToken = document.querySelector<HTMLButtonElement>('#add-token')!;
  assert.equal(errorPanel.hidden, false);
  assert.equal(errorPanel.getAttribute('role'), 'alert');
  assert.equal(document.activeElement, errorPanel);
  assert.match(document.querySelector('#error-title')!.textContent!, /GitHub request limit/);
  assert.match(errorMessage.textContent!, /add a GitHub token/);
  assert.doesNotMatch(errorMessage.textContent!, /GITHUB_TOKEN/);
  assert.equal(document.querySelector<HTMLButtonElement>('#scan')!.disabled, false);
  assert.equal(addToken.hidden, false);
  assert.equal(access.hidden, false);
  addToken.click();
  assert.equal(access.open, true);
  assert.equal(document.activeElement, tokenInput);
  assert.equal(tokenInput.type, 'password');

  tokenInput.value = 'invalid-token';
  await submit(true);
  assert.match(errorMessage.textContent!, /GitHub rejected this token/);
  assert.doesNotMatch(errorMessage.textContent!, /invalid-token/);

  tokenInput.value = 'valid-test-token';
  await submit(true);
  assert.equal(errorPanel.hidden, true, errorMessage.textContent!);
  assert.equal(document.querySelector('#skill-name')!.textContent, 'demo');
  assert.equal(input.value, 'https://github.com/owner/repo');
  assert.ok(authorizations.some(({ url, authorization }) => url.includes('/git/trees/') && authorization === 'Bearer valid-test-token'));
  assert.ok(authorizations.filter(({ url }) => url.startsWith('https://raw.githubusercontent.com/')).every(({ authorization }) => !authorization));
  assert.ok(requests.every((url) => !url.includes('token') && !url.includes('/search/code')));
  assert.ok(!dom.serialize().includes('valid-test-token'), 'Never embed the entered token in page HTML');

  mode = 'token-limited';
  await submit(true);
  assert.match(errorMessage.textContent!, /limited requests for this token/);
  assert.match(errorMessage.textContent!, /Wait for the limit to reset/);
  assert.equal(addToken.hidden, true);

  mode = 'allowed';
  tokenInput.value = '';
  await submit(true);
  assert.equal(errorPanel.hidden, true);
  assert.equal(document.querySelector('#skill-name')!.textContent, 'demo');
  assert.deepEqual(errors, []);
});
