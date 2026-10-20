import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const MAX_BATCHES = 10;
const branch = 'air/feedback-state';
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sha = (value) => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const kinds = ['review', 'review_comment', 'issue_comment'];
const activeStates = ['dispatching', 'dispatched', 'uncertain', 'running'];
const terminalStates = ['completed', 'blocked'];
class StalePRError extends Error {}
class StaleFeedbackError extends Error {}

function validateState(state) {
  if (state?.version !== 1 || !state.prs || typeof state.prs !== 'object' || Array.isArray(state.prs)) {
    throw new Error('Invalid or unsupported feedback state; refusing to reset it');
  }
  for (const [number, pr] of Object.entries(state.prs)) {
    if (!/^[1-9]\d*$/.test(number) || !Array.isArray(pr.batches) || pr.batches.length > MAX_BATCHES) throw new Error('Invalid PR state');
    for (const batch of pr.batches) {
      if (!/^[a-f0-9]{64}$/.test(batch.id) || !sha(batch.head_sha) ||
          ![...activeStates, ...terminalStates].includes(batch.status) ||
          !Array.isArray(batch.feedback) || batch.feedback.length === 0 ||
          batch.feedback.some((f) => !kinds.includes(f.kind) || !positive(f.id) || !/^[a-f0-9]{64}$/.test(f.version)) ||
          (batch.status === 'running' && typeof batch.worker_token !== 'string')) throw new Error('Invalid batch state');
    }
    const active = pr.batches.filter((b) => activeStates.includes(b.status));
    if (active.length > 1 || (pr.active ?? null) !== (active[0]?.id ?? null)) throw new Error('Invalid PR lock state');
  }
  return state;
}

/**
 * @param {{repository: string, request: (method: string, endpoint: string, body?: any) => Promise<any>, sendWebhook?: (payload: any) => Promise<{status: number}>, now?: () => string}} options
 */
export function createCoordinator({ repository, request, sendWebhook, now = () => new Date().toISOString() }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || repository.split('/').some((p) => p === '.' || p === '..')) {
    throw new Error('Set FEEDBACK_REPOSITORY to owner/repo');
  }
  const root = `repos/${repository}`;
  const refPath = `${root}/git/ref/heads/${branch}`;
  const updatePath = `${root}/git/refs/heads/${branch}`;

  async function load() {
    const ref = await request('GET', refPath);
    const commit = await request('GET', `${root}/git/commits/${ref.object.sha}`);
    const tree = await request('GET', `${root}/git/trees/${commit.tree.sha}`);
    const file = tree.tree.find((entry) => entry.path === 'state.json' && entry.type === 'blob');
    if (!file) throw new Error('Missing state.json; refusing to reset state');
    const blob = await request('GET', `${root}/git/blobs/${file.sha}`);
    if (blob.encoding !== 'base64') throw new Error('Unsupported state encoding');
    return { head: ref.object.sha, state: validateState(JSON.parse(Buffer.from(blob.content, 'base64').toString('utf8'))) };
  }

  async function commit(state, parent) {
    // A nonce ensures two concurrent reservations cannot produce an identical commit.
    state.revision = randomUUID();
    const tree = await request('POST', `${root}/git/trees`, {
      tree: [{ path: 'state.json', mode: '100644', type: 'blob', content: `${JSON.stringify(validateState(state), null, 2)}\n` }],
    });
    return request('POST', `${root}/git/commits`, {
      message: 'Update PR feedback coordination state', tree: tree.sha, parents: parent ? [parent] : [],
    });
  }

  async function transaction(change) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const { head, state } = await load();
      const result = change(state);
      if (!result.write) return result.value;
      const next = await commit(state, head);
      try {
        await request('PATCH', updatePath, { sha: next.sha, force: false });
        return result.value;
      } catch (error) {
        if (![409, 422].includes(error.status)) throw error;
        const current = await request('GET', refPath);
        if (current.object.sha === head) throw error;
        // A competing commit won. Reevaluate eligibility against its state.
      }
    }
    throw new Error('Feedback state contention limit reached; no dispatch performed');
  }

  function target(payload) {
    if (payload?.repository !== repository || !positive(payload.pr_number) || !sha(payload.head_sha)) throw new Error('Invalid feedback target');
  }

  async function fetchFeedback(number, references) {
    if (!Array.isArray(references) || !references.length || references.length > 100) throw new Error('Expected 1–100 feedback references');
    const found = new Map();
    for (const reference of references) {
      if (!kinds.includes(reference.kind) || !positive(reference.id)) throw new Error('Invalid feedback reference');
      const { kind, id } = reference;
      const path = kind === 'review' ? `pulls/${number}/reviews/${id}` : `${kind === 'review_comment' ? 'pulls' : 'issues'}/comments/${id}`;
      const original = await request('GET', `${root}/${path}`);
      const expected = `https://api.github.com/repos/${repository}/${kind === 'issue_comment' ? 'issues' : 'pulls'}/${number}`;
      if ((kind === 'issue_comment' ? original.issue_url : original.pull_request_url) !== expected || original.id !== id) {
        throw new Error('Feedback does not belong to the requested PR');
      }
      if (kind === 'review' && original.state === 'DISMISSED') throw new StaleFeedbackError('Review has been dismissed');
      const updated = original.updated_at ?? original.submitted_at;
      if (!updated || !Number.isFinite(Date.parse(updated)) || typeof original.body !== 'string') throw new Error('Incomplete feedback data');
      const version = hash([kind, id, updated, original.body, original.state ?? null]);
      found.set(`${kind}:${id}`, { kind, id, version, updated_at: updated, url: original.html_url });
    }
    return [...found.values()].sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));
  }

  async function currentPR(payload) {
    target(payload);
    const pr = await request('GET', `${root}/pulls/${payload.pr_number}`);
    if (pr.state !== 'open' || pr.head.sha !== payload.head_sha) throw new StalePRError('PR closed or head changed');
    if (pr.head.repo?.full_name !== repository) throw new Error('Fork PRs require a separate push policy');
    return pr;
  }

  async function getBatch(payload) {
    target(payload);
    if (!/^[a-f0-9]{64}$/.test(payload.batch_id ?? '')) throw new Error('Invalid batch ID');
    const { state } = await load();
    const batch = state.prs[payload.pr_number]?.batches.find((b) => b.id === payload.batch_id);
    if (!batch) throw new Error('Unknown batch');
    return batch;
  }

  function blockUnstarted(payload) {
    return transaction((state) => {
      const record = state.prs[payload.pr_number];
      const batch = record.batches.find((b) => b.id === payload.batch_id);
      if (!['dispatching', 'dispatched', 'uncertain'].includes(batch.status)) return { value: { status: 'not_startable' } };
      batch.status = 'blocked'; batch.reason = 'PR or feedback is no longer current'; record.active = null;
      return { write: true, value: { status: 'blocked' } };
    });
  }

  return {
    async init() {
      try { await load(); return { status: 'already_initialized', branch }; }
      catch (error) {
        if (error.status !== 404) throw error;
        // Only an absent ref allows initialization, not a missing state object.
        try { await request('GET', refPath); }
        catch (refError) { if (refError.status !== 404) throw refError; }
        const refs = await request('GET', `${root}/git/matching-refs/heads/${branch}`);
        if (refs.some((ref) => ref.ref === `refs/heads/${branch}`)) throw error;
      }
      const next = await commit({ version: 1, prs: {} });
      try { await request('POST', `${root}/git/refs`, { ref: `refs/heads/${branch}`, sha: next.sha }); }
      catch (error) {
        if (![409, 422].includes(error.status)) throw error;
        await load();
        return { status: 'already_initialized', branch };
      }
      return { status: 'initialized', branch };
    },

    async status(number) {
      if (number !== undefined && !positive(number)) throw new Error('Invalid PR number');
      const { state } = await load();
      return number === undefined ? state : state.prs[number] ?? { active: null, batches: [] };
    },

    /** Explicit local execution: reserve and start atomically, without a webhook. */
    async claim(payload) {
      const pr = await currentPR(payload);
      const feedback = await fetchFeedback(payload.pr_number, payload.feedback);
      return transaction((state) => {
        const record = state.prs[payload.pr_number] ??= { active: null, batches: [] };
        if (record.active) return { value: { status: 'busy', batch_id: record.active } };
        const seen = new Set(record.batches.flatMap((b) => b.feedback.map((f) => f.version)));
        const fresh = feedback.filter((f) => !seen.has(f.version));
        if (!fresh.length) return { value: { status: 'already_processed' } };
        if (record.batches.length >= MAX_BATCHES) return { value: { status: 'round_limit' } };
        const id = hash([repository, payload.pr_number, payload.head_sha, fresh.map((f) => f.version)]);
        const worker_token = randomUUID();
        record.batches.push({ id, head_sha: payload.head_sha, feedback: fresh, status: 'running',
          created_at: now(), started_at: now(), worker_token });
        record.active = id;
        return { write: true, value: { status: 'started', batch_id: id, worker_token,
          branch: pr.head.ref, head_sha: payload.head_sha, feedback: fresh } };
      });
    },

    async dispatch(payload) {
      await currentPR(payload);
      if (typeof sendWebhook !== 'function') throw new Error('Webhook sender is not configured');
      const feedback = await fetchFeedback(payload.pr_number, payload.feedback);
      const reservation = await transaction((state) => {
        const pr = state.prs[payload.pr_number] ??= { active: null, batches: [] };
        if (pr.active) return { value: { status: 'busy', batch_id: pr.active } };
        const seen = new Set(pr.batches.flatMap((b) => b.feedback.map((f) => f.version)));
        const fresh = feedback.filter((f) => !seen.has(f.version));
        if (!fresh.length) return { value: { status: 'already_processed' } };
        if (pr.batches.length >= MAX_BATCHES) return { value: { status: 'round_limit' } };
        const id = hash([repository, payload.pr_number, payload.head_sha, fresh.map((f) => f.version)]);
        const batch = { id, head_sha: payload.head_sha, feedback: fresh, status: 'dispatching', created_at: now() };
        pr.batches.push(batch);
        pr.active = id;
        return { write: true, value: { status: 'reserved', batch_id: id, feedback: fresh } };
      });
      if (reservation.status !== 'reserved') return reservation;
      const outbound = { repository, pr_number: payload.pr_number, head_sha: payload.head_sha,
        batch_id: reservation.batch_id, feedback: reservation.feedback };
      // Release only after a successful read proves the PR is stale. API failures
      // (including permission-masking 404s) leave the reservation for inspection.
      try { await currentPR(payload); }
      catch (error) {
        if (!(error instanceof StalePRError)) throw error;
        await transaction((state) => {
          const pr = state.prs[payload.pr_number];
          const batch = pr.batches.find((b) => b.id === reservation.batch_id);
          batch.status = 'blocked'; batch.reason = 'PR changed before dispatch'; pr.active = null;
          return { write: true, value: null };
        });
        return { status: 'blocked', batch_id: reservation.batch_id };
      }
      let accepted = false;
      try { const response = await sendWebhook(outbound); accepted = response.status >= 200 && response.status < 300; }
      catch { /* The request may already have arrived. Keep the lock. */ }
      await transaction((state) => {
        const pr = state.prs[payload.pr_number];
        const batch = pr.batches.find((b) => b.id === reservation.batch_id);
        if (batch.status !== 'dispatching') return { value: null };
        batch.status = accepted ? 'dispatched' : 'uncertain';
        return { write: true, value: null };
      });
      return { status: accepted ? 'dispatched' : 'uncertain', batch_id: reservation.batch_id };
    },

    async start(payload) {
      const stored = await getBatch(payload);
      if (!['dispatching', 'dispatched', 'uncertain'].includes(stored.status)) return { status: 'not_startable' };
      let pr, feedback;
      try {
        pr = await currentPR(payload);
      } catch (error) {
        // A PR-read 404 can mask lost access. Only an actual stale PR result
        // establishes that this reservation can be released.
        if (!(error instanceof StalePRError)) throw error;
        return blockUnstarted(payload);
      }
      try {
        if (stored.head_sha !== payload.head_sha) throw new Error('Batch head mismatch');
        feedback = await fetchFeedback(payload.pr_number, stored.feedback);
        if (hash(feedback) !== hash(stored.feedback)) throw new StaleFeedbackError('Feedback changed');
      } catch (error) {
        // An HTTP error cannot prove deletion: GitHub may hide inaccessible
        // feedback behind 404. Only a successful read can confirm staleness.
        if (!(error instanceof StaleFeedbackError)) throw error;
        return blockUnstarted(payload);
      }
      return transaction((state) => {
        const record = state.prs[payload.pr_number];
        const batch = record.batches.find((b) => b.id === payload.batch_id);
        if (record.active !== batch.id || !['dispatching', 'dispatched', 'uncertain'].includes(batch.status)) return { value: { status: 'not_startable' } };
        batch.status = 'running'; batch.worker_token = randomUUID(); batch.started_at = now();
        return { write: true, value: { status: 'started', worker_token: batch.worker_token,
          branch: pr.head.ref, head_sha: batch.head_sha, feedback: batch.feedback } };
      });
    },

    async finish(payload) {
      await getBatch(payload);
      if (!terminalStates.includes(payload.outcome) || (payload.pushed_sha !== undefined && !sha(payload.pushed_sha))) throw new Error('Invalid finish outcome');
      return transaction((state) => {
        const pr = state.prs[payload.pr_number];
        const batch = pr.batches.find((b) => b.id === payload.batch_id);
        if (pr.active !== batch.id || batch.status !== 'running' || !payload.worker_token || batch.worker_token !== payload.worker_token) throw new Error('Worker does not own this PR lock');
        batch.status = payload.outcome; batch.finished_at = now();
        if (payload.pushed_sha) batch.pushed_sha = payload.pushed_sha;
        pr.active = null;
        return { write: true, value: { status: payload.outcome, batch_id: batch.id } };
      });
    },

    async recover(payload) {
      await getBatch(payload);
      if (payload.confirmed_stopped !== true) throw new Error('Confirm the previous dispatch and worker have stopped before recovery');
      return transaction((state) => {
        const pr = state.prs[payload.pr_number];
        const batch = pr.batches.find((b) => b.id === payload.batch_id);
        if (pr.active !== batch.id) return { value: { status: 'not_active' } };
        batch.status = 'blocked'; batch.reason = 'Manually recovered after confirming worker stopped'; batch.finished_at = now(); pr.active = null;
        return { write: true, value: { status: 'recovered', batch_id: batch.id } };
      });
    },
  };
}

export async function githubRequest(method, endpoint, body) {
  const args = ['api', '--method', method, endpoint];
  if (body !== undefined) args.push('--input', '-');
  // Pass JSON on stdin, not through shell interpolation or command-line fields.
  return new Promise((resolve, reject) => {
    const child = execFile('gh', args, { maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const failure = new Error(`GitHub request failed: ${method} ${endpoint}`);
        failure.status = Number(stderr.match(/HTTP (\d{3})/)?.[1]) || undefined;
        reject(failure);
      } else {
        try { resolve(JSON.parse(stdout)); } catch { reject(new Error('Invalid GitHub response')); }
      }
    });
    child.stdin.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [command, file] = process.argv.slice(2);
    if (!['init', 'status', 'dispatch', 'claim', 'start', 'finish', 'recover'].includes(command)) throw new Error('Expected init, status, dispatch, claim, start, finish, or recover');
    let sendWebhook;
    if (command === 'dispatch') {
      const url = new URL(process.env.FIX_PR_FEEDBACK_URL ?? '');
      const token = process.env.FIX_PR_FEEDBACK_TOKEN;
      if (url.protocol !== 'https:' || url.username || url.password || !token || /[\r\n]/.test(token)) throw new Error('Configure an HTTPS FIX_PR_FEEDBACK_URL and FIX_PR_FEEDBACK_TOKEN');
      sendWebhook = (payload) => fetch(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
        headers: { Authorization: `ApiKey ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    }
    const coordinator = createCoordinator({ repository: process.env.FEEDBACK_REPOSITORY, request: githubRequest, sendWebhook });
    const payload = ['init', 'status'].includes(command) ? (file === undefined ? undefined : Number(file)) : JSON.parse(await readFile(file, 'utf8'));
    console.log(JSON.stringify(await coordinator[command](payload), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
