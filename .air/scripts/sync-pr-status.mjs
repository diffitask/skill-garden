import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createCoordinator, githubRequest, MAX_BATCHES } from './feedback-state.mjs';

const labels = {
  'AI: fixing': ['D4A017', 'A coordinated feedback fix is queued or running'],
  'AI: reviewing': ['0075CA', 'Waiting for a current review or successful pull-request CI'],
  'AI: changes requested': ['E99695', 'Current review has findings awaiting an automated fix'],
  'AI: needs human': ['D93F0B', 'Automation is blocked; inspect the latest report'],
  'AI: review passed': ['2DA44E', 'Current head has a clean review, successful PR CI, and no merge conflicts'],
};

/** Reconcile visual status from verified GitHub and coordinator data, never from label locks. */
export async function syncPrStatus({ repository, number, request }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || !Number.isSafeInteger(number) || number < 1) throw new Error('Invalid PR target');
  const root = `repos/${repository}`;
  const pr = await request('GET', `${root}/pulls/${number}`);
  if (pr.state !== 'open') return { status: 'closed' };
  const head = pr.head.sha;
  const record = await createCoordinator({ repository, request }).status(number);
  const active = record.batches.find((batch) => batch.id === record.active);
  let desired = 'AI: reviewing', reason = 'Waiting for a review of the current commit';
  if (active) {
    desired = active.status === 'uncertain' ? 'AI: needs human' : 'AI: fixing';
    reason = active.status === 'uncertain' ? 'Webhook delivery is uncertain; inspect the original run' : 'A coordinated fix is queued or running';
  } else {
    const comments = [];
    for (let page = 1; ; page++) {
      const batch = await request('GET', `${root}/issues/${number}/comments?per_page=100&page=${page}`);
      comments.push(...batch);
      if (batch.length < 100) break;
    }
    // Trust the configured Air reviewer and explicit repository-owner reports, not arbitrary markers.
    const reviews = comments.filter((comment) =>
      (['jetbrains-air', 'jetbrains-air[bot]'].includes(comment.user?.login) || comment.author_association === 'OWNER') &&
      comment.body?.startsWith(`<!-- air-code-review -->\n## Automated code review\n\nCommit: ${head}\n\n`));
    const review = reviews.sort((a, b) => b.id - a.id)[0];
    const latest = record.batches.at(-1);
    const outcome = review?.body.match(/^<!-- air-code-review -->\n## Automated code review\n\nCommit: [a-f0-9]{40}\n\n<!-- air-review:(clean|findings|failed) -->/)?.[1];
    if (outcome === 'failed') { desired = 'AI: needs human'; reason = 'The current review failed to complete'; }
    else if (outcome === 'findings') {
      const version = createHash('sha256').update(JSON.stringify(['issue_comment', review.id, review.updated_at, review.body, review.state ?? null])).digest('hex');
      const attempted = record.batches.some((batch) => batch.feedback.some((f) => f.kind === 'issue_comment' && f.id === review.id && f.version === version));
      desired = record.batches.length >= MAX_BATCHES || attempted ? 'AI: needs human' : 'AI: changes requested';
      reason = record.batches.length >= MAX_BATCHES ? 'Ten feedback attempts have been used' : attempted ? 'The attempted finding remains unresolved; inspect the fix report' : 'Current findings await the next watcher dispatch';
    } else if (outcome === 'clean') {
      // This repository defines its CI policy in .github/workflows/ci.yml.
      // Actions read access works even when Checks/status-check endpoints return 403.
      const runs = [];
      for (let page = 1; ; page++) {
        const data = await request('GET', `${root}/actions/workflows/ci.yml/runs?head_sha=${head}&event=pull_request&per_page=100&page=${page}`);
        runs.push(...data.workflow_runs);
        if (data.workflow_runs.length < 100) break;
      }
      const run = runs.filter((run) => run.head_sha === head && run.event === 'pull_request' &&
        run.path === '.github/workflows/ci.yml' && run.head_repository?.full_name === repository &&
        run.pull_requests?.some((p) => p.number === number)).sort((a, b) => b.id - a.id)[0];
      if (!run || run.status !== 'completed') reason = 'Clean review; waiting for pull-request CI for this commit';
      else if (run.conclusion !== 'success') { desired = 'AI: needs human'; reason = `Pull-request CI concluded ${run.conclusion}`; }
      else if (pr.draft) reason = 'Clean review and CI; PR is still a draft';
      else if (pr.mergeable === false || pr.mergeable_state === 'dirty') { desired = 'AI: needs human'; reason = 'Merge conflicts must be resolved'; }
      else if (pr.mergeable === true && pr.mergeable_state === 'clean') { desired = 'AI: review passed'; reason = 'Current review and pull-request CI passed; ready for the maintainer to merge'; }
      else reason = 'Clean review and CI; waiting for GitHub to confirm merge readiness';
    } else if (latest?.status === 'blocked' && latest.head_sha === head) {
      desired = 'AI: needs human'; reason = 'Latest fix attempt was blocked';
    }
  }
  // Recheck after slow reads; never apply a decision for a superseded commit.
  const current = await request('GET', `${root}/pulls/${number}`);
  if (current.state !== 'open' || current.head.sha !== head) return { status: 'superseded' };
  // A new worker may have started during the reads. Let its next reconciliation win.
  const currentRecord = await createCoordinator({ repository, request }).status(number);
  if (currentRecord.active !== record.active || currentRecord.batches.length !== record.batches.length) return { status: 'superseded' };
  const existing = new Set(current.labels.map((label) => label.name));
  // Remove stale green first. Preserve all labels outside this managed set.
  for (const name of ['AI: review passed', ...Object.keys(labels).filter((name) => name !== 'AI: review passed')]) {
    if (name !== desired && existing.has(name)) await request('DELETE', `${root}/issues/${number}/labels/${encodeURIComponent(name)}`);
  }
  if (!existing.has(desired)) await request('POST', `${root}/issues/${number}/labels`, { labels: [desired] });
  return { status: desired, head_sha: head, reason };
}

export async function ensureStatusLabels(repository, request) {
  const existing = [];
  for (let page = 1; ; page++) {
    const batch = await request('GET', `repos/${repository}/labels?per_page=100&page=${page}`);
    existing.push(...batch);
    if (batch.length < 100) break;
  }
  for (const [name, [color, description]] of Object.entries(labels)) {
    if (!existing.some((label) => label.name === name)) await request('POST', `repos/${repository}/labels`, { name, color, description });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [number] = process.argv.slice(2);
  const repository = process.env.FEEDBACK_REPOSITORY;
  console.log(JSON.stringify(await syncPrStatus({ repository, number: Number(number), request: githubRequest })));
}
