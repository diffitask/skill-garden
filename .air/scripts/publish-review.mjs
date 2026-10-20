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
  const body = `${marker}\n## Automated code review\n\nCommit: ${env.PR_HEAD_SHA}\n\n${message}${runUrl ? `\n\n[Automation run](${runUrl})` : ''}`;
  const params = { ...context.repo, issue_number: number };
  return await github.rest.issues.createComment({ ...params, body });
}

// The Air environment provides GitHub CLI authentication through its GitHub integration.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const exec = promisify(execFile);

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
  return publishReview({ github, context: { repo: { owner, repo } }, env });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = { ...process.env, REVIEW_MESSAGE: await readFile(process.argv[2], 'utf8') };
  const result = await runPublisher(env, async (method, endpoint, body) => {
    const args = ['api', '--method', method, endpoint];
    if (body) args.push('-f', `body=${body.body}`);
    const { stdout } = await exec('gh', args, { maxBuffer: 4 * 1024 * 1024 });
    return JSON.parse(stdout);
  });
  console.log(result?.skipped ? 'PR closed or head changed; review not published.' : `PR review comment published: ${result.html_url}`);
}
