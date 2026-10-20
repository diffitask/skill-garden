import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runPublisher } from '../.air/scripts/publish-review.mjs';

const sha = 'a'.repeat(40);
const marker = '<!-- air-code-review -->';
async function publish(env: Record<string, string | undefined> = {}, comments: any[] = [], pr = { state: 'open', head: { sha } }, failWrite = false) {
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
      const page = Number(new URL(`https://github.com/${endpoint}`).searchParams.get('page'));
      return comments.slice((page - 1) * 100, page * 100);
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

test('Air publisher paginates and updates only a bot-owned review marker', async () => {
  const comments = [
    { id: 1, user: { type: 'User' }, body: marker },
    ...Array.from({ length: 99 }, (_, id) => ({ id: id + 10, user: { type: 'Bot' }, body: 'Other comment' })),
    { id: 2, user: { type: 'Bot' }, body: `${marker}\nOld review` },
  ];
  const { calls, reads } = await publish({ REVIEW_MESSAGE: 'Updated review' }, comments);
  assert.equal(calls[0].method, 'PATCH');
  assert.equal(calls[0].endpoint, 'repos/owner/repo/issues/comments/2');
  assert.ok(calls[0].body.body.includes('Updated review'));
  assert.ok(reads.some((path) => path.endsWith('page=2')));
});

test('failed generation and empty output publish failure notices', async () => {
  for (const env of [{ REVIEW_RESULT: 'failure', REVIEW_MESSAGE: 'Partial review' }, { REVIEW_MESSAGE: ' ' }]) {
    const { calls } = await publish(env);
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
    const { calls, result } = await publish({}, [], pr);
    assert.deepEqual(result, { skipped: true });
    assert.equal(calls.length, 0);
  }
  await assert.rejects(publish({}, [], undefined, true), /denied comment access/);
});
