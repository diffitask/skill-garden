import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parse } from 'yaml';

const workflow = parse(readFileSync(new URL('../.github/workflows/code-review.yml', import.meta.url), 'utf8'));
const script = workflow.jobs.publish.steps[0].with.script;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

async function publish(env: Record<string, string>, comments: unknown[] = []) {
  const calls: { method: string; params: any }[] = [];
  const issues = {
    listComments: () => {},
    createComment: async (params: unknown) => { calls.push({ method: 'create', params }); },
    updateComment: async (params: unknown) => { calls.push({ method: 'update', params }); },
  };
  const github = { rest: { issues }, paginate: async () => comments };
  await new AsyncFunction('github', 'context', 'process', script)(github, { repo: { owner: 'owner', repo: 'repo' } }, {
    env: { PR_NUMBER: '8', GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'owner/repo', GITHUB_RUN_ID: '123', ...env },
  });
  return calls;
}

test('review publishes findings or no-findings output as one PR comment with a workflow link', async () => {
  for (const message of ['Bug at src/example.ts:12. Reproduce: input 0; expected 0, actual 1.', 'No actionable bugs found.']) {
    const calls = await publish({ REVIEW_RESULT: 'success', REVIEW_MESSAGE: message });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'create');
    assert.equal(calls[0].params.issue_number, 8);
    assert.ok(calls[0].params.body.includes(message));
    assert.ok(calls[0].params.body.includes('https://github.com/owner/repo/actions/runs/123'));
  }
});

test('reruns update only the bot-owned review comment', async () => {
  const calls = await publish({ REVIEW_RESULT: 'success', REVIEW_MESSAGE: 'Updated review' }, [
    { id: 1, user: { login: 'someone' }, body: '<!-- automated-code-review -->' },
    { id: 2, user: { login: 'github-actions[bot]' }, body: '<!-- automated-code-review -->\nOld review' },
  ]);
  assert.equal(calls[0].method, 'update');
  assert.equal(calls[0].params.comment_id, 2);
  assert.ok(calls[0].params.body.includes('Updated review'));
});

test('missing key, failed generation, and empty output publish actionable failures', async () => {
  for (const env of [
    { REVIEW_RESULT: 'failure', MISSING_KEY: 'true', REVIEW_MESSAGE: '' },
    { REVIEW_RESULT: 'failure', MISSING_KEY: '', REVIEW_MESSAGE: 'Partial review' },
    { REVIEW_RESULT: 'success', MISSING_KEY: '', REVIEW_MESSAGE: ' ' },
  ]) {
    const calls = await publish(env);
    assert.match(calls[0].params.body, env.MISSING_KEY ? /OPENAI_API_KEY/ : /did not complete/);
    assert.ok(!calls[0].params.body.includes('Partial review'));
  }
});

test('oversized reviews are bounded and invalid PR numbers cannot publish', async () => {
  const calls = await publish({ REVIEW_RESULT: 'success', REVIEW_MESSAGE: 'x'.repeat(70000) });
  assert.ok(calls[0].params.body.length < 65536);
  assert.match(calls[0].params.body, /truncated/);
  await assert.rejects(publish({ PR_NUMBER: 'not-a-number' }), /Invalid PR number/);
});

test('workflow handles PR updates and manual review while separating generation and publication permissions', () => {
  assert.ok(workflow.on.pull_request.types.includes('synchronize'));
  assert.equal(workflow.on.workflow_dispatch.inputs.pr_number.required, true);
  assert.equal(workflow.permissions.contents, 'read');
  assert.equal(workflow.jobs.review.permissions, undefined);
  assert.equal(workflow.jobs.publish.permissions['pull-requests'], 'write');
  assert.match(workflow.jobs.review.if, /head.repo.full_name == github.repository/);
  assert.ok(workflow.jobs.review.steps.some((step: any) => step.with?.['permission-profile'] === ':read-only'));
});
