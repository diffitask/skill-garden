import assert from 'node:assert/strict';
import { test } from 'node:test';
import { syncPrStatus, ensureStatusLabels } from '../.air/scripts/sync-pr-status.mjs';

const repository = 'owner/repo';
const sha = 'a'.repeat(40);
const review = (outcome = 'clean', head = sha, id = 10, extra = {}) => ({ id, user: { login: 'jetbrains-air' },
  body: `<!-- air-code-review -->\n## Automated code review\n\nCommit: ${head}\n\n<!-- air-review:${outcome} -->\nReview report`, ...extra });
const batch = (status = 'completed', id = 'b'.repeat(64)) => ({ id, head_sha: sha, status, feedback: [
  { kind: 'issue_comment', id: 1, version: 'f'.repeat(64) }], ...(status === 'running' ? { worker_token: 'worker' } : {}) });
function fixture() {
  const pr: any = { state: 'open', draft: false, mergeable: true, mergeable_state: 'clean', head: { sha }, labels: [{ name: 'enhancement' }] };
  const record: any = { active: null, batches: [] };
  const comments: any[] = [review()];
  const runs: any[] = [{ id: 1, head_sha: sha, event: 'pull_request', path: '.github/workflows/ci.yml',
    head_repository: { full_name: repository }, pull_requests: [{ number: 17 }], status: 'completed', conclusion: 'success' }];
  const calls: any[] = [];
  let prReads = 0;
  const options: any = {};
  async function request(method: string, endpoint: string, body?: any): Promise<any> {
    calls.push({ method, endpoint, body });
    if (method === 'GET') {
      if (endpoint.endsWith('/pulls/17')) {
        if (++prReads === 2 && options.changedHead) pr.head.sha = 'c'.repeat(40);
        if (prReads === 2 && options.closed) pr.state = 'closed';
        if (prReads === 2 && options.secondPR) Object.assign(pr, options.secondPR);
        return structuredClone(pr);
      }
      if (endpoint.includes('/git/ref/')) return { object: { sha: '1' } };
      if (endpoint.includes('/git/commits/')) return { tree: { sha: '2' } };
      if (endpoint.includes('/git/trees/')) return { tree: [{ path: 'state.json', type: 'blob', sha: '3' }] };
      if (endpoint.includes('/git/blobs/')) return { encoding: 'base64', content: Buffer.from(JSON.stringify({ version: 1, prs: { 17: record } })).toString('base64') };
      if (endpoint.includes('/comments?')) return endpoint.endsWith('page=1') ? structuredClone(comments) : [];
      if (endpoint.includes('/actions/')) {
        if (options.ciError) throw new Error('Actions access denied');
        assert.ok(endpoint.includes(`head_sha=${sha}&event=pull_request`));
        return { workflow_runs: endpoint.endsWith('page=1') ? structuredClone(runs) : [] };
      }
    }
    if (method === 'DELETE') {
      if (options.failWrite) throw new Error('Label write denied');
      const name = decodeURIComponent(endpoint.split('/').at(-1)!);
      pr.labels = pr.labels.filter((l: any) => l.name !== name);
      return [];
    }
    if (method === 'POST' && endpoint.endsWith('/labels')) {
      if (options.failWrite) throw new Error('Label write denied');
      pr.labels.push(...body.labels.map((name: string) => ({ name })));
      return pr.labels;
    }
    throw new Error(`Unexpected request ${method} ${endpoint}`);
  }
  return { pr, record, comments, runs, calls, options, run: () => syncPrStatus({ repository, number: 17, request }) };
}

test('ready label requires exact current clean review, successful PR CI and merge readiness; preserve unrelated labels', async () => {
  const f = fixture();
  f.pr.labels.push({ name: 'AI: needs human' });
  assert.equal((await f.run()).status, 'AI: review passed');
  assert.deepEqual(f.pr.labels.map((l: any) => l.name), ['enhancement', 'AI: review passed']);
  assert.ok(!f.calls.some((c) => c.endpoint.includes('check-runs') || c.endpoint.includes('/status')));
});

test('stale, untrusted, unknown or failed reviews cannot grant readiness; newest report wins', async () => {
  for (const item of [review('clean', 'b'.repeat(40)), review('clean', sha, 10, { user: { login: 'outsider' } }),
    review('unknown'), review('failed', sha, 10, { body: review('failed').body + '\n' + review('clean').body })]) {
    const f = fixture(); f.comments.splice(0, 1, item); f.pr.labels.push({ name: 'AI: review passed' });
    assert.notEqual((await f.run()).status, 'AI: review passed');
    assert.ok(!f.pr.labels.some((l: any) => l.name === 'AI: review passed'));
  }
  const f = fixture(); f.comments.push(review('findings', sha, 11));
  assert.equal((await f.run()).status, 'AI: changes requested');
});

test('pending, missing, failed, cancelled, unrelated, wrong-SHA CI or newer failed runs cannot grant green', async () => {
  for (const change of [{ status: 'in_progress' }, { conclusion: 'failure' }, { conclusion: 'cancelled' },
    { head_sha: 'b'.repeat(40) }, { event: 'push' }, { path: '.github/workflows/other.yml' },
    { pull_requests: [{ number: 18 }] }, { head_repository: { full_name: 'fork/repo' } }]) {
    const f = fixture(); Object.assign(f.runs[0], change);
    assert.notEqual((await f.run()).status, 'AI: review passed');
  }
  const f = fixture(); f.runs.push({ ...f.runs[0], id: 2, conclusion: 'failure' });
  assert.equal((await f.run()).status, 'AI: needs human');
  const empty = fixture(); empty.runs.length = 0;
  assert.equal((await empty.run()).status, 'AI: reviewing');
});

test('drafts, conflicts, unknown mergeability and ownership block readiness', async () => {
  for (const change of [{ draft: true }, { mergeable: false, mergeable_state: 'dirty' }, { mergeable: null, mergeable_state: 'unknown' }, { mergeable_state: 'blocked' }]) {
    const f = fixture(); Object.assign(f.pr, change);
    assert.notEqual((await f.run()).status, 'AI: review passed');
  }
  for (const state of ['running', 'dispatched', 'uncertain']) {
    const f = fixture(); const b = batch(state); f.record.batches.push(b); f.record.active = b.id;
    assert.equal((await f.run()).status, state === 'uncertain' ? 'AI: needs human' : 'AI: fixing');
  }
});

test('ten attempts require human attention; fresh findings below the cap await automation', async () => {
  for (const count of [3, 10]) {
    const f = fixture(); f.comments.splice(0, 1, review('findings'));
    for (let i = 0; i < count; i++) f.record.batches.push(batch('completed', i.toString(16).padStart(64, '0')));
    assert.equal((await f.run()).status, count === 10 ? 'AI: needs human' : 'AI: changes requested');
  }
  const f = fixture(); f.record.batches.push(batch('blocked')); f.comments.length = 0;
  assert.equal((await f.run()).status, 'AI: needs human');
});

test('head changes and closed PRs skip label writes; API and write failures propagate without retries', async () => {
  for (const option of ['changedHead', 'closed']) {
    const f = fixture(); f.options[option] = true;
    assert.equal((await f.run()).status, 'superseded');
    assert.ok(f.calls.every((c) => c.method === 'GET'));
  }
  const f = fixture(); f.options.ciError = true;
  await assert.rejects(f.run(), /Actions access denied/);
  assert.ok(f.calls.every((c) => c.method === 'GET'));
  const failed = fixture(); failed.options.failWrite = true;
  await assert.rejects(failed.run(), /Label write denied/);
  assert.equal(failed.calls.filter((c) => c.method === 'POST').length, 1);
});

test('label setup creates only missing labels and is idempotent', async () => {
  const existing: any[] = [];
  const request = async (method: string, endpoint: string, body?: any) => {
    assert.ok(endpoint.startsWith('repos/owner/repo/labels'));
    if (method === 'GET') return existing;
    assert.equal(method, 'POST'); existing.push(body); return body;
  };
  await ensureStatusLabels(repository, request);
  assert.equal(existing.length, 5);
  await ensureStatusLabels(repository, request);
  assert.equal(existing.length, 5);
});


test('the final PR read decides mergeability, including delayed calculation and newly introduced conflicts', async () => {
  const delayed = fixture();
  Object.assign(delayed.pr, { mergeable: null, mergeable_state: 'unknown' });
  delayed.options.secondPR = { mergeable: true, mergeable_state: 'clean' };
  assert.equal((await delayed.run()).status, 'AI: review passed');
  for (const changed of [{ mergeable: false, mergeable_state: 'dirty' }, { draft: true }]) {
    const f = fixture(); f.options.secondPR = changed;
    assert.notEqual((await f.run()).status, 'AI: review passed');
  }
});
