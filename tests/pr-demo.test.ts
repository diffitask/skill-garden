import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspectDemo, publishDemo } from '../.air/scripts/publish-pr-demo.mjs';

const head = 'a'.repeat(40), base = 'b'.repeat(40);
const env = {
  DEMO_REPOSITORY: 'owner/repo', PR_NUMBER: '8', PR_HEAD_SHA: head, PR_BASE_SHA: base,
  DEMO_VIDEO_URL: 'https://example.org/demo.webm', DEMO_MESSAGE: 'Filter changes now identify skills not sent to the model.',
};
const current = () => ({
  state: 'open', draft: false, head: { sha: head, repo: { full_name: 'owner/repo' } },
  base: { sha: base, repo: { full_name: 'owner/repo' } }, labels: [{ name: 'AI: review passed' }],
});
function fixture() {
  const comments: any[] = [{ id: 1, body: 'Human discussion' }];
  let pr = current(), reads = 0;
  const writes: any[] = [];
  const calls: string[] = [];
  let onPrRead = () => {};
  let failure = '';
  const request = async (method: string, endpoint: string, payload?: any): Promise<any> => {
    calls.push(`${method} ${endpoint}`);
    if (failure === `${method} ${endpoint}`) throw new Error('GitHub access failed');
    if (method === 'GET' && endpoint === 'repos/owner/repo/pulls/8') { reads++; onPrRead(); return structuredClone(pr); }
    const page = /comments\?per_page=100&page=(\d+)$/.exec(endpoint);
    if (method === 'GET' && page) return comments.slice((Number(page[1]) - 1) * 100, Number(page[1]) * 100);
    if (method === 'POST' && endpoint === 'repos/owner/repo/issues/8/comments') {
      writes.push(payload);
      const id = comments.length + 1;
      const comment = { id, body: payload.body, html_url: `https://github.com/owner/repo/pull/8#issuecomment-${id}`,
        issue_url: 'https://api.github.com/repos/owner/repo/issues/8' };
      comments.push(comment);
      return structuredClone(comment);
    }
    const id = /issues\/comments\/(\d+)$/.exec(endpoint);
    if (method === 'GET' && id) return structuredClone(comments.find((c) => c.id === Number(id[1])));
    assert.fail(`Unexpected request: ${method} ${endpoint}`);
  };
  return { request, comments, writes, calls, get reads() { return reads; }, get pr() { return pr; },
    set pr(value) { pr = value; }, set onPrRead(value: () => void) { onPrRead = value; },
    set failure(value: string) { failure = value; } };
}

test('demo publication appends and reads back a video, optional preview and exact revisions', async () => {
  for (const preview of ['', 'https://example.org/preview.png']) {
    const f = fixture();
    const result = await publishDemo({ ...env, DEMO_PREVIEW_URL: preview }, f.request);
    assert.equal(result.skipped, false);
    assert.equal(f.writes.length, 1);
    assert.equal(f.comments[0].body, 'Human discussion');
    const body = f.comments.at(-1).body;
    for (const text of [env.DEMO_MESSAGE, env.DEMO_VIDEO_URL, head, base, `<!-- pr-demo:v1:${head} -->`]) assert.ok(body.includes(text));
    assert.equal(body.includes('![Demo preview]'), Boolean(preview));
    assert.equal(f.calls.at(-1), 'GET repos/owner/repo/issues/comments/2');
  }
});

test('check is read-only and sequential reruns skip the existing head, preserving history', async () => {
  const f = fixture();
  assert.deepEqual(await inspectDemo(env, f.request), { skipped: false });
  assert.equal(f.writes.length, 0);
  const first = await publishDemo(env, f.request);
  const second = await publishDemo(env, f.request);
  assert.equal(second.skipped, true);
  assert.equal(second.html_url, first.html_url);
  assert.equal(f.writes.length, 1);
  const next = 'c'.repeat(40);
  f.pr.head.sha = next;
  assert.equal((await publishDemo({ ...env, PR_HEAD_SHA: next }, f.request)).skipped, false);
  assert.equal(f.writes.length, 2);
});

test('demo deduplication traverses all comment pages', async () => {
  const f = fixture();
  while (f.comments.length < 100) f.comments.push({ body: 'A discussion comment' });
  f.comments.push({ body: `<!-- pr-demo:v1:${head} -->\nAlready delivered`, html_url: 'https://example.org/existing' });
  const result = await publishDemo(env, f.request);
  assert.equal(result.html_url, 'https://example.org/existing');
  assert.equal(f.writes.length, 0);
  assert.ok(f.calls.includes('GET repos/owner/repo/issues/8/comments?per_page=100&page=2'));
});

test('closed, draft, fork, wrong base/repository, superseded and non-green PRs never publish', async () => {
  const changes = [
    (pr: any) => { pr.state = 'closed'; }, (pr: any) => { pr.draft = true; },
    (pr: any) => { pr.head.repo.full_name = 'fork/repo'; }, (pr: any) => { pr.base.repo.full_name = 'other/repo'; },
    (pr: any) => { pr.head.sha = 'c'.repeat(40); }, (pr: any) => { pr.base.sha = 'c'.repeat(40); },
    (pr: any) => { pr.labels = []; },
  ];
  for (const change of changes) {
    const f = fixture(); change(f.pr);
    assert.equal((await publishDemo(env, f.request)).skipped, true);
    assert.equal(f.writes.length, 0);
  }
});

test('eligibility is rechecked after slow comment reads', async () => {
  for (const change of [(pr: any) => { pr.head.sha = 'c'.repeat(40); }, (pr: any) => { pr.labels = []; }, (pr: any) => { pr.state = 'closed'; }]) {
    const f = fixture();
    f.onPrRead = () => { if (f.reads === 2) change(f.pr); };
    const result = await publishDemo(env, f.request);
    assert.equal(result.skipped, true);
    assert.equal(f.writes.length, 0);
  }
});

test('invalid target, empty/oversized report and invalid media URLs fail before API access', async () => {
  for (const overrides of [
    { DEMO_REPOSITORY: '../repo' }, { PR_NUMBER: '8.0' }, { PR_NUMBER: '0' }, { PR_NUMBER: '9007199254740992' },
    { PR_HEAD_SHA: 'short' }, { PR_BASE_SHA: 'B'.repeat(40) },
    { DEMO_MESSAGE: '' }, { DEMO_MESSAGE: 'x'.repeat(60001) },
    { DEMO_VIDEO_URL: '' }, { DEMO_VIDEO_URL: 'file:///tmp/demo.webm' }, { DEMO_VIDEO_URL: 'http://example.org/demo.webm' },
    { DEMO_VIDEO_URL: 'https://token@example.org/demo.webm' }, { DEMO_PREVIEW_URL: 'http://example.org/preview.png' },
  ]) {
    const f = fixture();
    await assert.rejects(publishDemo({ ...env, ...overrides }, f.request));
    assert.equal(f.calls.length, 0);
  }
});

test('GitHub read/write failures propagate and never retry a comment write', async () => {
  for (const endpoint of ['GET repos/owner/repo/pulls/8', 'GET repos/owner/repo/issues/8/comments?per_page=100&page=1', 'POST repos/owner/repo/issues/8/comments']) {
    const f = fixture(); f.failure = endpoint;
    await assert.rejects(publishDemo(env, f.request), /access failed/);
    assert.equal(f.calls.filter((call) => call === endpoint).length, 1);
  }
});

test('uncertain readback retains publication URL and never retries or edits the comment', async () => {
  const f = fixture(); f.failure = 'GET repos/owner/repo/issues/comments/2';
  await assert.rejects(publishDemo(env, f.request), /may be published at https:\/\/github.com\/owner\/repo\/pull\/8#issuecomment-2; inspect before retrying/);
  assert.equal(f.writes.length, 1);
  assert.equal((await publishDemo(env, f.request)).skipped, true);
});

test('malformed comments and mismatched saved comment fail visibly', async () => {
  for (const mode of ['list', 'readback']) {
    const f = fixture();
    const request = async (method: string, endpoint: string, body?: any) => {
      if (mode === 'list' && endpoint.includes('?per_page=')) return {};
      const response = await f.request(method, endpoint, body);
      if (mode === 'readback' && endpoint === 'repos/owner/repo/issues/comments/2') response.issue_url = 'https://api.github.com/repos/owner/repo/issues/9';
      return response;
    };
    await assert.rejects(publishDemo(env, request), /Invalid GitHub comments|readback mismatch/);
    assert.equal(f.writes.length, mode === 'readback' ? 1 : 0);
  }
});
