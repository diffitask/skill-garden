import { syncPrStatus } from './sync-pr-status.mjs';
import { githubRequest } from './feedback-state.mjs';
export async function publishReview({ github, context, env }) {
  const number = Number(env.PR_NUMBER);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error('Invalid PR number');
  if (!/^[a-f0-9]{40}$/.test(env.PR_HEAD_SHA ?? '')) throw new Error('Invalid head SHA');
  const marker = '<!-- air-code-review -->';
  const { data: pr } = await github.rest.pulls.get({ ...context.repo, pull_number: number });
  if (pr.state !== 'open' || pr.head.sha !== env.PR_HEAD_SHA) return { skipped: true };
  let message;
  if (env.REVIEW_RESULT === 'success' && env.REVIEW_MESSAGE?.trim()) {
    message = env.REVIEW_MESSAGE.trim();
  } else {
    message = 'Code review did not complete. Check the workflow log and rerun it; no review result is available.';
  }
  const runUrl = env.REVIEW_RUN_URL;
  if (runUrl && new URL(runUrl).protocol !== 'https:') throw new Error('Invalid run URL');
  // Leave room for metadata within GitHub's comment size limit.
  if (message.length > 60000) message = `${message.slice(0, 60000)}\n\nReview truncated; see the workflow log.`;
  const outcome = env.REVIEW_RESULT === 'success' && env.REVIEW_MESSAGE?.trim() && env.REVIEW_MESSAGE.length <= 60000
    ? env.REVIEW_OUTCOME : 'failed';
  const outcomeMarker = ['clean', 'findings', 'failed'].includes(outcome) ? `<!-- air-review:${outcome} -->\n` : '';
  const body = `${marker}\n## Automated code review\n\nCommit: ${env.PR_HEAD_SHA}\n\n${outcomeMarker}${message}${runUrl ? `\n\n[Automation run](${runUrl})` : ''}`;
  const params = { ...context.repo, issue_number: number };
  return await github.rest.issues.createComment({ ...params, body });
}

// The Air environment provides GitHub CLI authentication through its GitHub integration.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export async function runPublisher(env, request) {
  const match = /^([a-zA-Z0-9][\w.-]*)\/([a-zA-Z0-9][\w.-]*)$/.exec(env.REVIEW_REPOSITORY ?? '');
  if (!match) throw new Error('Set REVIEW_REPOSITORY to owner/repo');
  const [, owner, repo] = match;
  const endpoint = `repos/${owner}/${repo}`;
  const github = {
    rest: {
      pulls: { get: async ({ pull_number }) => ({ data: await request('GET', `${endpoint}/pulls/${pull_number}`) }) },
      issues: {
        createComment: async ({ issue_number, body }) => request('POST', `${endpoint}/issues/${issue_number}/comments`, { body }),
      },
    },
  };
  const result = await publishReview({ github, context: { repo: { owner, repo } }, env });
  if (!result?.skipped && env.REVIEW_OUTCOME) {
    const status = await syncPrStatus({ repository: `${owner}/${repo}`, number: Number(env.PR_NUMBER), request });
    return { ...result, pr_status: status };
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = { ...process.env, REVIEW_MESSAGE: await readFile(process.argv[2], 'utf8') };
  const result = await runPublisher(env, githubRequest);
  console.log(result?.skipped ? 'PR closed or head changed; review not published.' : `PR review comment published: ${result.html_url}`);
}
