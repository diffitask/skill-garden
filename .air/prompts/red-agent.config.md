# Red Agent – ai-workshop-2026

Repository: `diffitask/ai-workshop-2026`. Owner: repository maintainer.
This is a configuration record, not an Air automation definition.
Activation: the maintainer reports that Red Agent and Issue to PR exist, and supplied a Red Agent run report at application SHA `6368b9d6ccc4d498e8ad3f81b419f1e585f31926`. This session cannot inspect or edit their live Air settings. That run exercised both views but found no new bug, so the automatic issue-to-PR handoff remains unverified. Repository files alone do not enable or change a trigger.

## Red Agent

- Name: Red Agent – ai-workshop-2026.
- Instructions: `Follow instructions from .agents/skills/red-agent/SKILL.md.`
- Checkout: trusted main branch after this skill is merged.
- Trigger: manual Run Now initially; suggested recurring schedule: daily at 09:00 UTC. Enable the recurring trigger only after a successful manual run.
- Runtime: centrally authenticated project agent; Node >=24, npm, Git, authenticated GitHub CLI, a real browser with video recording (or Playwright/Chromium and its system libraries).
- Access: read this repository and public GitHub inputs; create issues/apply labels; publish sanitized evidence to dedicated evidence branches. No separate model API key is needed for an Air coding agent.
- Git output: use an instructions-controlled mode that permits issue publication and pushes of dedicated `air/red-agent-evidence-<run-id>` branches; do not select a blanket no-commits/no-pushes restriction when this evidence fallback is needed. The skill still prohibits application code changes and leaves fix PRs to Issue to PR. If the selected environment provides durable issue-readable video attachments instead, evidence pushes are unnecessary. Verify the actual mode in the current Air UI.
- Delivery: one issue per confirmed bug, video and exact reproduction steps, label `Delegated to AI`; final report links all filed issues. No Slack/email notifications.
- Limits: 20 minutes and at most three new issues per run; deduplicate against existing issues/PRs. Access failures require inspection; do not automatically retry uncertain writes.

## Issue-to-PR consumer (required for automatic fixes)

Check for an existing live consumer before creating another:
- Repository: same repository, trusted main checkout.
- Trigger: issue opened with label `Delegated to AI`, and label added to an existing issue. Check the current label and ignore closed issues, PR events and already-linked fixes. Ensure overlapping opened/labeled events cannot create duplicate workers or PRs.
- Instructions: `Implement the triggering GitHub issue using .agents/skills/issue-to-pr/SKILL.md. Read the issue and reproduce its failure first. Reuse an existing fix PR; otherwise update the spec, add regression integration coverage, run all local checks, and open one PR that closes the issue. Never merge automatically.`
- Git output: new branch and pull request, authorized to push and create the linked PR.
- Access: issue read, repository write, PR write, CI read; same central agent runtime.

## Activation evidence

Record actual automation URLs/configuration revisions, merged skill SHA, manual run URL, issue/video URLs, and the independently triggered linked fix PR. A local manual reproduction validates bug discovery only. A PR implemented in an interactive session does not validate the issue trigger. Do not mark the loop operational until both live automations and the complete handoff are observed.

## Maintainer-supplied Air run report

- Both views were explored at application SHA `6368b9d6ccc4d498e8ad3f81b419f1e585f31926`; issue #21's fixed overflow did not recur. No new defect or issue was reported.
- Populated organization behavior, partial upstream failures and successful model-backed AI clustering were not exercised. Claude Code was absent. These remain coverage gaps, not evidence of correct behavior.
- The report states: "this run prohibits evidence-branch commits/pushes" and no artifact-upload tool returned an issue-readable URL. This blocks the configured video-publication fallback even though no issue needed publication in that run. The maintainer must resolve the live output restriction or provide durable video attachments; editing this record does not change Air permissions.

## Local manual discovery validation (2026-10-21)

- Tested application main at `25ebaa9c58dfdfd327355c4d79b48a599f41bf58` using real Chromium 156.0.8078.4 at 320 × 900; scanned public JetBrains/kotlin with no mocked responses.
- Reproduced the same cluster-selector overflow in fresh contexts for the server and portable page: 340 px document/control right edge in a 320 px viewport.
- Published and read back [issue #21](https://github.com/diffitask/ai-workshop-2026/issues/21), with `bug` and `Delegated to AI` labels.
- Both videos and measurement JSON are pinned to evidence commit `048e7cad96c3c7ad29bd67eed6dbb06df2f2e0f2` on `air/red-agent-evidence-20261021-mobile`.
- Skill frontmatter validation, all 87 existing tests and TypeScript checks passed. This was an interactive run of the skill; there is no Air Run Now URL or verified live discovery/issue-consumer trigger.
