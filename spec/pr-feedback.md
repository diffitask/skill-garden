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
  order, allow other PRs to proceed, and permit at most three batches per PR.
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
- CLI commands are `init`, `status`, `dispatch`, `start`, `finish`, and `recover`.
  Commands after `status` take a JSON file; `status` optionally takes a PR number.
  Use `FEEDBACK_REPOSITORY=diffitask/ai-workshop-2026`. Webhook access is needed only
  for `dispatch`, via `FIX_PR_FEEDBACK_URL` and `FIX_PR_FEEDBACK_TOKEN`.
- Read-only Git output in Air prohibits code changes but the watcher is explicitly
  allowed to write the dedicated state branch and invoke the fix webhook. The fix
  worker is allowed to write state, manage PR labels/comments, and push the existing
  PR branch. Instructions must be loaded from the trusted default branch, not PR code.
- Integration tests cover initialization races, concurrent claims and worker starts,
  conflicting updates, duplicate/edited feedback, multiple PRs, three-round limits,
  stale/closed/foreign PRs, malformed input/state, permission and transport failures,
  fast workers, ownership checks, completion, and explicit recovery.
