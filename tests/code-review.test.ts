import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runPublisher } from '../.air/scripts/publish-review.mjs';

const sha = 'a'.repeat(40);
const marker = '<!-- air-code-review -->';
async function publish(env: Record<string, string | undefined> = {}, pr = { state: 'open', head: { sha } }, failWrite = false) {
  const calls: { method: string; endpoint: string; body: any }[] = [];
  const reads: string[] = [];
  const result = await runPublisher({
    REVIEW_REPOSITORY: 'owner/repo', PR_NUMBER: '8', PR_HEAD_SHA: sha,
    REVIEW_RESULT: 'success', REVIEW_MESSAGE: 'No actionable bugs found.',
    REVIEW_RUN_URL: 'https://air.jetbrains.cloud/example/run', ...env,
  }, async (method: string, endpoint: string, body: any) => {
    if (method === 'GET') {
      reads.push(endpoint);
      if (endpoint === 'repos/owner/repo/pulls/8') return pr;
      assert.fail(`Unexpected GitHub read: ${endpoint}`);
    }
    if (failWrite) throw new Error('GitHub denied comment access');
    calls.push({ method, endpoint, body });
    return { html_url: 'https://github.com/owner/repo/pull/8#issuecomment-1' };
  });
  return { calls, reads, result };
}

test('Air publisher posts findings and no-findings output with the reviewed SHA and optional run link', async () => {
  for (const message of ['Bug at src/example.ts:12. Reproduce: input 0; expected 0, actual 1.', 'No actionable bugs found.']) {
    const { calls } = await publish({ REVIEW_MESSAGE: message });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].endpoint, 'repos/owner/repo/issues/8/comments');
    assert.ok(calls[0].body.body.includes(message));
    assert.ok(calls[0].body.body.includes(sha));
    assert.ok(calls[0].body.body.includes('https://air.jetbrains.cloud/example/run'));
  }
  const { calls } = await publish({ REVIEW_RUN_URL: '' });
  assert.ok(!calls[0].body.body.includes('[Automation run]'));
});

test('each review run appends a new comment, including reruns on the same SHA, preserving history', async () => {
  const comments = [
    { id: 1, body: `${marker}\nOld review` },
    { id: 2, body: 'Human discussion' },
  ];
  const originals = structuredClone(comments);
  const urls: string[] = [];
  for (const [index, head] of [sha, sha, 'b'.repeat(40)].entries()) {
    const result = await runPublisher({
      REVIEW_REPOSITORY: 'owner/repo', PR_NUMBER: '8', PR_HEAD_SHA: head,
      REVIEW_RESULT: 'success', REVIEW_MESSAGE: `Review run ${index + 1}`,
    }, async (method: string, endpoint: string, body: any) => {
      if (method === 'GET' && endpoint === 'repos/owner/repo/pulls/8') return { state: 'open', head: { sha: head } };
      assert.equal(method, 'POST', 'past reviews must never be edited');
      assert.equal(endpoint, 'repos/owner/repo/issues/8/comments');
      const id = comments.length + 1;
      comments.push({ id, body: body.body });
      return { html_url: `https://github.com/owner/repo/pull/8#issuecomment-${id}` };
    });
    urls.push(result.html_url);
    assert.ok(comments.at(-1)!.body.includes(`Review run ${index + 1}`));
    assert.ok(comments.at(-1)!.body.includes(head));
  }
  assert.equal(comments.length, 5);
  assert.equal(new Set(urls).size, 3);
  assert.deepEqual(comments.slice(0, 2), originals);
});

test('failed generation and empty output publish failure notices', async () => {
  for (const env of [{ REVIEW_RESULT: 'failure', REVIEW_MESSAGE: 'Partial review' }, { REVIEW_MESSAGE: ' ' }]) {
    const { calls } = await publish(env);
    assert.equal(calls[0].method, 'POST');
    assert.match(calls[0].body.body, /did not complete/);
    assert.ok(!calls[0].body.body.includes('Partial review'));
  }
});

test('publisher rejects invalid targets and bounds oversized reviews', async () => {
  const { calls } = await publish({ REVIEW_MESSAGE: 'x'.repeat(70000) });
  assert.ok(calls[0].body.body.length < 65536);
  assert.match(calls[0].body.body, /truncated/);
  for (const env of [{ PR_NUMBER: 'no' }, { REVIEW_REPOSITORY: '../repo' }, { PR_HEAD_SHA: 'no' }, { REVIEW_RUN_URL: 'http://example.com' }]) {
    await assert.rejects(publish(env), /Invalid|Set REVIEW_REPOSITORY/);
  }
});

test('closed PRs and superseded commits are skipped and publication failures propagate without retry', async () => {
  for (const pr of [{ state: 'closed', head: { sha } }, { state: 'open', head: { sha: 'b'.repeat(40) } }]) {
    const { calls, result } = await publish({}, pr);
    assert.deepEqual(result, { skipped: true });
    assert.equal(calls.length, 0);
  }
  await assert.rejects(publish({}, undefined, true), /denied comment access/);
});
