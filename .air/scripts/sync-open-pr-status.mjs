import { githubRequest } from './feedback-state.mjs';
import { syncPrStatus } from './sync-pr-status.mjs';

const repository = process.env.FEEDBACK_REPOSITORY;
if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '')) throw new Error('Set FEEDBACK_REPOSITORY');
let failed = false;
for (let page = 1; ; page++) {
  const prs = await githubRequest('GET', `repos/${repository}/pulls?state=open&per_page=100&page=${page}`);
  for (const pr of prs) {
    try {
      console.log(JSON.stringify({ pr: pr.number, ...await syncPrStatus({ repository, number: pr.number, request: githubRequest }) }));
    } catch (error) {
      failed = true;
      console.error(`PR #${pr.number}: ${error instanceof Error ? error.message : 'Status reconciliation failed'}`);
    }
  }
  if (prs.length < 100) break;
}
if (failed) process.exitCode = 1;
