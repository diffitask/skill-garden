import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createCoordinator } from '../.air/scripts/feedback-state.mjs';

const repository = 'owner/repo';
const head = 'a'.repeat(40);
const payload = (pr_number = 17, ids = [1]) => ({ repository, pr_number, head_sha: head,
  feedback: ids.map((id) => ({ kind: 'issue_comment', id })) });
const fail = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

// GitHub API fixture: immutable objects and a fast-forward-only reference, shared
// across independent clients. Every request yields so concurrent transactions race.
function github() {
  let sequence = 0;
  let ref: string | undefined;
  const objects = new Map<string, any>();
  const prs = new Map<number, any>();
  const feedback = new Map<string, any>();
  const calls: { method: string; path: string; body: any }[] = [];
  let intercept: ((method: string, path: string, body: any) => void) | undefined;
  const put = (object: any) => { const id = (++sequence).toString(16).padStart(40, '0'); objects.set(id, object); return id; };
  const addPR = (number: number) => prs.set(number, { state: 'open', head: { sha: head, ref: `feature-${number}`, repo: { full_name: repository } } });
  const comment = (number: number, id: number, kind = 'issue_comment') => {
    const item = { id, body: 'This input loses completed results. Preserve them.', updated_at: '2026-10-20T12:00:00Z',
      submitted_at: '2026-10-20T12:00:00Z', state: 'COMMENTED',
      issue_url: `https://api.github.com/repos/${repository}/issues/${number}`,
      pull_request_url: `https://api.github.com/repos/${repository}/pulls/${number}`,
      html_url: `https://github.com/${repository}/pull/${number}#${kind}-${id}` };
    feedback.set(kind === 'review' ? `pulls/${number}/reviews/${id}` : `${kind === 'review_comment' ? 'pulls' : 'issues'}/comments/${id}`, item);
    return item;
  };
  addPR(17); addPR(16);
  for (const id of [1, 2, 3, 4]) comment(17, id);
  comment(16, 10);
  async function request(method: string, endpoint: string, body?: any): Promise<any> {
    await setImmediate();
    const path = endpoint.replace(`repos/${repository}/`, '');
    calls.push({ method, path, body });
    intercept?.(method, path, body);
    if (method === 'GET') {
      if (path.startsWith('git/matching-refs/')) return ref ? [{ ref: 'refs/heads/air/feedback-state' }] : [];
      if (path === 'git/ref/heads/air/feedback-state') {
        if (!ref) throw fail(404);
        return { object: { sha: ref } };
      }
      if (/^git\/(commits|trees|blobs)\//.test(path)) {
        const object = objects.get(path.split('/').at(-1)!);
        if (!object) throw fail(404);
        return structuredClone(object);
      }
      if (/^pulls\/\d+$/.test(path)) {
        const pr = prs.get(Number(path.split('/')[1]));
        if (!pr) throw fail(404);
        return structuredClone(pr);
      }
      if (feedback.has(path)) return structuredClone(feedback.get(path));
    }
    if (method === 'POST' && path === 'git/trees') {
      const tree = body.tree.map((file: any) => ({ ...file, sha: put({ encoding: 'base64', content: Buffer.from(file.content).toString('base64') }) }));
      return { sha: put({ tree }) };
    }
    if (method === 'POST' && path === 'git/commits') return { sha: put({ tree: { sha: body.tree }, parents: body.parents }) };
    if (method === 'POST' && path === 'git/refs') {
      if (ref) throw fail(422);
      ref = body.sha;
      return { object: { sha: ref } };
    }
    if (method === 'PATCH' && path === 'git/refs/heads/air/feedback-state') {
      assert.equal(body.force, false, 'coordination must never force-update state');
      let ancestor = body.sha;
      while (ancestor && ancestor !== ref) ancestor = objects.get(ancestor)?.parents[0];
      if (ancestor !== ref) throw fail(422);
      ref = body.sha;
      return { object: { sha: ref } };
    }
    throw fail(404);
  }
  function corrupt() {
    const commit = objects.get(ref!);
    const tree = objects.get(commit.tree.sha);
    const blob = objects.get(tree.tree[0].sha);
    blob.content = Buffer.from('{"version":999,"prs":{}}').toString('base64');
  }
  function advance() {
    const current = objects.get(ref!);
    ref = put({ tree: current.tree, parents: [ref] });
  }
  return { request, prs, feedback, calls, comment, corrupt, advance, setIntercept: (fn: typeof intercept) => { intercept = fn; } };
}

async function fixture(send?: (body: any) => Promise<any>) {
  const api = github();
  const deliveries: any[] = [];
  const options = { repository, request: api.request, sendWebhook: send ?? (async (body: any) => { deliveries.push(body); return { status: 202 }; }) };
  const client = createCoordinator(options);
  await client.init();
  return { api, client, options, deliveries };
}

test('state must be explicitly initialized; concurrent initialization preserves one valid state', async () => {
  const api = github();
  const clients = [1, 2].map(() => createCoordinator({ repository, request: api.request }));
  await assert.rejects(clients[0].status(), /404/);
  const results = await Promise.all(clients.map((c) => c.init()));
  assert.deepEqual(results.map((r) => r.status).sort(), ['already_initialized', 'initialized']);
  assert.deepEqual((await clients[0].status()).prs, {});
  assert.equal((await clients[1].init()).status, 'already_initialized');
  api.corrupt();
  await assert.rejects(clients[0].init(), /unsupported/);
  await assert.rejects(clients[0].status(), /unsupported/);
});

test('independent watchers race for the same PR: exactly one webhook is sent, without expiry', async () => {
  const { client, options, deliveries } = await fixture();
  const second = createCoordinator({ ...options, now: () => '2027-01-01T00:00:00Z' });
  const results = await Promise.all([client.dispatch(payload()), second.dispatch(payload())]);
  assert.deepEqual(results.map((r) => r.status).sort(), ['busy', 'dispatched']);
  assert.equal(deliveries.length, 1);
  assert.equal((await second.dispatch(payload())).status, 'busy');
  const state = await client.status(17);
  assert.equal(state.batches.length, 1);
  assert.equal(state.active, deliveries[0].batch_id);
});

test('other PRs remain independent and concurrent state commits do not lose updates', async () => {
  const { client, options, deliveries } = await fixture();
  await Promise.all([client.dispatch(payload()), createCoordinator(options).dispatch(payload(16, [10]))]);
  assert.equal(deliveries.length, 2);
  assert.equal((await client.status(17)).batches.length, 1);
  assert.equal((await client.status(16)).batches.length, 1);
});

test('duplicate webhook deliveries cannot start two workers; only the owner can finish', async () => {
  const { client, options, deliveries } = await fixture();
  await client.dispatch(payload());
  const batch = deliveries[0];
  // Payload feedback is not authoritative; the stored references are used.
  const results = await Promise.all([client.start({ ...batch, feedback: [] }), createCoordinator(options).start(batch)]);
  const started = results.find((r) => r.status === 'started');
  assert.ok(started);
  assert.deepEqual(results.map((r) => r.status).sort(), ['not_startable', 'started']);
  assert.equal(started.branch, 'feature-17');
  await assert.rejects(client.finish({ ...batch, worker_token: 'wrong', outcome: 'completed' }), /does not own/);
  assert.equal((await client.status(17)).active, batch.batch_id);
  await client.finish({ ...batch, worker_token: started.worker_token, outcome: 'completed', pushed_sha: 'b'.repeat(40) });
  assert.equal((await client.status(17)).active, null);
  assert.equal((await client.start(batch)).status, 'not_startable');
  assert.equal((await client.dispatch(payload())).status, 'already_processed');
});

test('deduplicate feedback, recognize edits, ignore input ordering, and enforce three rounds', async () => {
  const { client, api, deliveries } = await fixture();
  const first = await client.dispatch(payload(17, [2, 1, 1]));
  const parallel = await fixture();
  const reordered = await parallel.client.dispatch(payload(17, [1, 2]));
  assert.equal(first.batch_id, reordered.batch_id);
  for (let round = 0; round < 3; round++) {
    if (round) {
      // An edit at the same timestamp must also form a new version.
      api.feedback.get('issues/comments/1').body += ' Updated finding.';
      assert.equal((await client.dispatch(payload())).status, 'dispatched');
    }
    const batch = deliveries.at(-1);
    const worker = await client.start(batch);
    await client.finish({ ...batch, worker_token: worker.worker_token, outcome: round === 1 ? 'blocked' : 'completed' });
    assert.equal((await client.dispatch(payload())).status, 'already_processed');
  }
  assert.equal((await client.dispatch(payload(17, [4]))).status, 'round_limit');
  assert.equal((await client.status(17)).batches.length, 3);
  assert.equal((await client.status(999)).active, null);
});

test('all feedback kinds are fetched and versioned; foreign comments and dismissed reviews fail closed', async () => {
  const { client, api, deliveries } = await fixture();
  api.comment(17, 11, 'review'); api.comment(17, 12, 'review_comment');
  const input = { ...payload(), feedback: [{ kind: 'review', id: 11 }, { kind: 'review_comment', id: 12 }, { kind: 'issue_comment', id: 1 }] };
  await client.dispatch(input);
  assert.equal(deliveries[0].feedback.length, 3);
  const state = JSON.stringify(await client.status());
  assert.ok(!state.includes('Preserve them'), 'comment bodies must not be persisted');
  const other = await fixture();
  other.api.comment(16, 99);
  await assert.rejects(other.client.dispatch(payload(17, [99])), /does not belong/);
  other.api.comment(17, 100, 'review').state = 'DISMISSED';
  await assert.rejects(other.client.dispatch({ ...payload(), feedback: [{ kind: 'review', id: 100 }] }), /dismissed/);
  assert.equal(other.deliveries.length, 0);
});

test('closed, changed, foreign and malformed targets cannot dispatch', async () => {
  const { client, api, deliveries } = await fixture();
  await assert.rejects(client.dispatch({ ...payload(), repository: 'other/repo' }), /Invalid/);
  for (const change of [ { state: 'closed' }, { head: { sha: 'b'.repeat(40) } }, { head: { sha: head, repo: { full_name: 'fork/repo' } } } ]) {
    const original = structuredClone(api.prs.get(17));
    Object.assign(api.prs.get(17), change);
    await assert.rejects(client.dispatch(payload()), /closed|changed|Fork/);
    api.prs.set(17, original);
  }
  for (const value of [{ ...payload(), pr_number: -1 }, { ...payload(), head_sha: 'bad' }, { ...payload(), feedback: [] }, { ...payload(), feedback: [{ kind: 'other', id: 1 }] }]) {
    await assert.rejects(client.dispatch(value), /Invalid|Expected/);
  }
  assert.throws(() => createCoordinator({ repository: '../repo', request: api.request }), /FEEDBACK_REPOSITORY/);
  await assert.rejects(client.status(-1), /Invalid/);
  assert.equal(deliveries.length, 0);
});

test('changes between reservation and delivery prevent dispatch; stale workers do not edit', async () => {
  const { client, api, deliveries } = await fixture();
  let reads = 0;
  api.setIntercept((method, path) => {
    if (method === 'GET' && path === 'pulls/17' && ++reads === 2) api.prs.get(17).head.sha = 'b'.repeat(40);
  });
  assert.equal((await client.dispatch(payload())).status, 'blocked');
  assert.equal(deliveries.length, 0);
  assert.equal((await client.status(17)).active, null);
  const second = await fixture();
  await second.client.dispatch(payload());
  second.api.feedback.get('issues/comments/1').body = 'Withdrawn: no change needed.';
  assert.equal((await second.client.start(second.deliveries[0])).status, 'blocked');
  assert.equal((await second.client.status(17)).active, null);
  const third = await fixture();
  await third.client.dispatch(payload());
  third.api.prs.get(17).state = 'closed';
  assert.equal((await third.client.start(third.deliveries[0])).status, 'blocked');
});

test('timeouts and HTTP failures retain locks, prevent resends, and require explicit recovery', async () => {
  for (const mode of ['timeout', 'http']) {
    let attempts = 0;
    const { client, deliveries } = await fixture(async () => { attempts++; if (mode === 'timeout') throw new Error('Timeout containing a secret'); return { status: 500 }; });
    const result = await client.dispatch(payload());
    assert.equal(result.status, 'uncertain');
    assert.ok(!JSON.stringify(await client.status()).includes('secret'));
    assert.equal((await client.dispatch(payload())).status, 'busy');
    assert.equal(attempts, 1);
    const recovery = { ...payload(), batch_id: result.batch_id };
    await assert.rejects(client.recover(recovery), /Confirm/);
    assert.equal((await client.recover({ ...recovery, confirmed_stopped: true })).status, 'recovered');
    assert.equal((await client.recover({ ...recovery, confirmed_stopped: true })).status, 'not_active');
    assert.equal((await client.dispatch(payload())).status, 'already_processed');
    assert.equal(deliveries.length, 0);
  }
});

test('a worker may complete before the webhook response without state regression', async () => {
  let client: any;
  const setup = await fixture(async (body) => {
    const worker = await client.start(body);
    await client.finish({ ...body, worker_token: worker.worker_token, outcome: 'completed' });
    return { status: 202 };
  });
  client = setup.client;
  assert.equal((await client.dispatch(payload())).status, 'dispatched');
  const record = await client.status(17);
  assert.equal(record.active, null);
  assert.equal(record.batches[0].status, 'completed');
});

test('permission and unknown write failures fail closed without a webhook or retry', async () => {
  for (const stage of ['permission', 'lost-write-response']) {
    const { client, api, deliveries } = await fixture();
    let writes = 0;
    api.setIntercept((method, path) => {
      if (method === 'PATCH') { writes++; throw stage === 'permission' ? fail(403) : new Error('Connection closed'); }
    });
    await assert.rejects(client.dispatch(payload()), /403|Connection closed/);
    assert.equal(writes, 1);
    assert.equal(deliveries.length, 0);
  }
  const { client, api, deliveries } = await fixture();
  await client.dispatch(payload());
  api.setIntercept((method, path) => { if (path === 'issues/comments/1') throw fail(403); });
  await assert.rejects(client.start(deliveries[0]), /403/);
  assert.ok((await client.status(17)).active);
});

test('repeated competing state updates stop at the contention limit without dispatch', async () => {
  const { client, api, deliveries } = await fixture();
  let attempts = 0;
  api.setIntercept((method) => {
    if (method === 'PATCH') { attempts++; api.advance(); throw fail(422); }
  });
  await assert.rejects(client.dispatch(payload()), /contention limit/);
  assert.equal(attempts, 5);
  assert.equal(deliveries.length, 0);
  assert.equal((await client.status(17)).active, null);
});

test('missing stored objects cannot cause an initialized store to be reset', async () => {
  const { client, api } = await fixture();
  api.setIntercept((method, path) => { if (method === 'GET' && path.startsWith('git/blobs/')) throw fail(404); });
  const writesBefore = api.calls.filter((call) => call.method !== 'GET').length;
  await assert.rejects(client.init(), /404/);
  assert.equal(api.calls.filter((call) => call.method !== 'GET').length, writesBefore);
});

test('deleted feedback blocks the reserved batch; invalid finish cannot release it', async () => {
  const { client, api, deliveries } = await fixture();
  await client.dispatch(payload());
  await assert.rejects(client.finish({ ...deliveries[0], outcome: 'not-an-outcome' }), /Invalid finish/);
  assert.ok((await client.status(17)).active);
  api.feedback.delete('issues/comments/1');
  assert.equal((await client.start(deliveries[0])).status, 'blocked');
  assert.equal((await client.status(17)).active, null);
});

test('a lost response after a committed reservation retains the lock without sending', async () => {
  const api = github();
  let loseResponse = true;
  let sends = 0;
  const client = createCoordinator({ repository,
    request: async (method: string, path: string, body?: any) => {
      const result = await api.request(method, path, body);
      if (method === 'PATCH' && loseResponse) { loseResponse = false; throw new Error('Response lost after commit'); }
      return result;
    },
    sendWebhook: async () => { sends++; return { status: 202 }; },
  });
  await client.init();
  await assert.rejects(client.dispatch(payload()), /Response lost/);
  assert.ok((await client.status(17)).active);
  assert.equal((await client.dispatch(payload())).status, 'busy');
  assert.equal(sends, 0);
});
