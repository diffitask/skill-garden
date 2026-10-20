# Watch and fix PR feedback

Repository: `diffitask/ai-workshop-2026`. Maintainer: repository owner.
Status: state initialized on GitHub on 2026-10-20, with no active batches. A live
GitHub probe confirmed exactly one of two competing sibling state updates succeeds;
the temporary probe branch was removed. Repository tests cover the coordination
protocol. No live fix webhook was called, and no end-to-end Air run is verified.
Air-side settings are not changed by these files. Record automation URLs and the
merged instruction revision after setup.

## Watch PR Feedback

- Instructions: `Follow the trusted default-branch instructions in .air/prompts/watch-pr-feedback.md.`
- Trigger: repeat every 10 minutes; one trigger only.
- Checkout: default branch. Git output: No code changes.
- Explicit external writes: dedicated `air/feedback-state` branch, stale status label
  removal, and the fix webhook. No application/PR branch changes.
- Environment: Node >=24, authenticated `gh`, GitHub API and fix webhook network
  access. GitHub Contents write, PR read, and Issues write for labels; no Actions
  variables permission required. Use the existing connected GitHub identity.
- Shared secrets: `FIX_PR_FEEDBACK_URL`, `FIX_PR_FEEDBACK_TOKEN` (raw token).
- Notifications: empty; the prompt invokes the webhook selectively.

## Fix PR Feedback

- Instructions: `Follow the trusted default-branch instructions in .air/prompts/fix-pr-feedback.md.`
- Trigger: inbound Webhook. Copy its URL/API key into the watcher's shared secrets.
- Environment: same state repository and GitHub permissions, plus ability to push
  existing PR branches and publish PR comments. Never inject credentials into
  untrusted test processes.
- Webhook checkout does not select the PR branch automatically. The worker checks
  out the verified branch returned by `start`. Ensure Git output settings permit
  the existing-branch push and do not create an additional PR. The exact Air control
  must be verified in the active UI; do not claim it is configured from this record.
- Notifications: empty.

## Initialization and activation

After reviewing/merging, run once from a trusted checkout:

```sh
FEEDBACK_REPOSITORY=diffitask/ai-workshop-2026 node .air/scripts/feedback-state.mjs init
FEEDBACK_REPOSITORY=diffitask/ai-workshop-2026 node .air/scripts/feedback-state.mjs status
```

The state branch is a persistent operational record; do not delete or merge it into
main. It contains no application code or secrets. On a public repository, references,
outcomes, and worker ownership IDs are public. Only authenticated writers may mutate
it. Do not add a push-triggered automation covering this branch; PR new-commit
triggers can continue to review actual PR pushes.

Run Watch manually once and verify the target PR, one batch/worker, labels, pushed
SHA, repeated review, and terminal state before relying on the schedule. Both Air
definitions must use these concrete helpers instead of older abstract-store prompts.
Store access is not proof that webhook delivery or Air branch output is configured.

## Recovery

First inspect `status <PR-number>` and the corresponding Air runs. Do not recover
while a worker or delayed dispatch can still be active. Cancel/confirm they have
stopped, then explicitly run `recover <file>` with repository, pr_number, original
head_sha, batch_id, and `confirmed_stopped: true`. This marks the attempt blocked,
preserves history/deduplication, and releases the lock. It does not retry the same
feedback or reset the ten-round limit. Requests for another attempt require a
deliberate new feedback version, within the limit, or a reviewed future recovery
change; never delete state to bypass limits. Manual recovery is not an automation
action. Errors require inspection, not automatic write retries.

## Readiness loop
- Fix Git output must be “as the instructions say”; checkout remains main for trusted instructions. The worker switches to the coordinator-verified PR branch and pushes that branch only.
- Ten batches are allowed per PR. Watch reconciles labels on every poll, including after CI completes. Reviewer publication also reconciles; no human label toggles are required.
- Actions read access is sufficient for the configured CI readiness gate; Checks API access is not required. Air trigger settings themselves remain external configuration.

- `.github/workflows/pr-status.yml` now reconciles labels on GitHub events and every five minutes, using only trusted default-branch code and the workflow token. Air is still responsible for finding/fixing/reviewing code; status updates do not need a separate human run.
