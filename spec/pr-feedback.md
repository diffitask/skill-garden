# PR feedback coordination

- Use authenticated GitHub CLI access with repository Contents write and PR read
  permissions. No repository variables, database, or new service token is needed.
  This provides coordination, not feedback classification or Air configuration.
- Store versioned JSON in the dedicated `air/feedback-state` branch, separate from
  application code. Initialize explicitly; never silently recreate missing state.
  Store only feedback references/hashes, batch outcomes, and coordination IDs, never
  comment bodies, webhook credentials, or arbitrary agent messages.
- Change state with a new commit whose only parent is the observed state head,
  then fast-forward the ref with `force: false`. On competing updates, reload and
  reevaluate, at most five times. Authentication, validation, and uncertain network
  failures fail closed. Corrupt or unsupported state is never reset automatically.
- Dispatch validates an open same-repository PR and exact current head, fetches
  feedback from GitHub and verifies PR membership. Feedback kinds are `review`,
  `review_comment`, and `issue_comment`; the version hashes original body and
  timestamps, so edits count as new feedback. Classification and relevance to the
  current code remain the watcher's responsibility.
- Atomically reserve one active batch per PR before calling the webhook. Deduplicate
  feedback versions across batches, produce stable batch IDs independent of input
  order, allow other PRs to proceed, and permit at most ten batches per PR.
- When rechecking a reserved PR before dispatch, release the lock only if a
  successful GitHub read confirms that the PR closed or its head changed. Access,
  rate-limit, server, and transport errors propagate and retain the reservation for
  inspection; a permission-masking 404 is not proof of a stale PR. Subsequent polls
  return `busy`, without sending a webhook or consuming an additional round.
- Send the webhook exactly once with `Authorization: ApiKey <token>`. Persist
  acceptance without overwriting a worker that already started or finished. A
  timeout or non-success response leaves an uncertain batch locked for inspection;
  later polls must not redispatch it. An accepted HTTP response is not a completed fix.
- A worker must atomically start the stored batch, validating repository, PR head,
  and unchanged original feedback, and receive its unique worker token before any
  editing. Duplicate deliveries must not start a second worker. Payload copies are
  not authoritative; feedback and branch come from GitHub and stored state.
- Worker PR-read failures, including permission-masking 404s, propagate without
  changing the reservation. Distinguish them from successfully read stale/closed
  PRs and from successfully read changed/dismissed feedback. Restoring access permits
  starting the same reserved batch without another webhook delivery or fix round.
- Feedback-read failures follow the same rule for reviews, inline comments, and
  ordinary comments: all access, rate-limit, server, and transport errors retain
  the reservation. A missing-feedback 404 is indistinguishable from lost access;
  retain its lock for inspection/manual recovery, even if deletion is the cause.
  Only a successful read confirming edited or dismissed feedback releases the
  unstarted reservation automatically. Invalid batch-head input also preserves it.
- Only that worker token may finish the active batch. Record `completed` or
  `blocked`, and an optional pushed SHA, then release the PR atomically. Processed
  feedback stays recorded, including blocked attempts. New feedback can form a new
  batch within the limit. A changed/closed PR or edited feedback blocks an unstarted
  batch and releases it without editing code.
- Locks have no automatic expiry: a slow worker must not lose ownership to another.
  Manual recovery requires explicitly confirming the old worker/dispatch has stopped;
  it records the batch as blocked and retains history. Never use labels as locks.
- CLI commands are `init`, `status`, `dispatch`, `claim`, `start`, `finish`, and `recover`.
  Commands after `status` take a JSON file; `status` optionally takes a PR number.
  Use `FEEDBACK_REPOSITORY=diffitask/ai-workshop-2026`. Webhook access is needed only
  for `dispatch`, via `FIX_PR_FEEDBACK_URL` and `FIX_PR_FEEDBACK_TOKEN`.
- Read-only Git output in Air prohibits code changes but the watcher is explicitly
  allowed to write the dedicated state branch and invoke the fix webhook. The fix
  worker is allowed to write state, manage PR labels/comments, and push the existing
  PR branch. Instructions must be loaded from the trusted default branch, not PR code.
- Integration tests cover initialization races, concurrent claims and worker starts,
  conflicting updates, duplicate/edited feedback, multiple PRs, ten-round limits,
  stale/closed/foreign PRs, malformed input/state, permission and transport failures,
  fast workers, ownership checks, completion, and explicit recovery.

## Visible PR status
- Reconcile labels using the trusted `.air/scripts/sync-pr-status.mjs` after review publication and on every watcher poll, including PRs with no new feedback. Labels are indicators, never locks.
- Queued/running batches show `AI: fixing`; uncertain delivery and blocked attempts show `AI: needs human`. Fresh unattempted review findings show `AI: changes requested`; exhausted ten-attempt limits require a human. Superseded reviews cannot mark the current head ready.
- Otherwise show `AI: reviewing` while waiting for a current review or PR CI. Preserve unrelated labels and remove stale managed labels, especially stale green status.
- A trusted Air reviewer or repository-owner report must mark the exact current head `air-review:clean` before `AI: review passed` can be applied. Also require a completed successful pull_request run of `.github/workflows/ci.yml` for the exact head/repository/PR, a non-draft open PR, no active fix, and GitHub mergeable state clean. Use Actions read access rather than requiring the inaccessible Checks/status APIs. A failed/cancelled CI needs attention; a pending/missing run waits. GitHub branch/rule enforcement remains authoritative at merge time.
- Recheck the PR head/open state and coordinator ownership before label writes. Never merge automatically. Propagate access, malformed state and label-write errors; never mark an unverifiable PR ready.

- Explicitly authorized local execution may use `claim` with verified repository, PR number, current head SHA and original feedback references. It validates the same PR/feedback and atomically reserves and starts one worker without a webhook. It returns the real batch ID, branch and worker token; it shares locks, history, deduplication and the ten-attempt cap with webhook workers. Finish with the normal worker protocol. Never use claim to bypass an existing reservation or to silently retry attempted feedback.

- A trusted-default-branch GitHub Actions workflow reconciles open-PR status after PR changes, comment changes and CI completion, plus every five minutes. It executes no PR code and consumes no PR artifacts; its token has only Contents/PR/Actions read and Issues write. One PR's reconciliation error is reported without preventing checks of other PRs. This makes label transitions independent of Air run timing; it does not replace the Air fix/review agents or merge PRs.
