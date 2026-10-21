# Status Update — ai-workshop-2026

This is a configuration record, not a live Air automation definition.
Activation: NOT CREATED. This session has no Air automation creation/editing tool.

- Name: Status Update — ai-workshop-2026.
- Repository: `diffitask/ai-workshop-2026`; trusted default branch with this skill available.
- Prompt: `Follow instructions from .agents/skills/status-update/SKILL.md.`
- Trigger: the user will configure the schedule in Air. Reporting timezone: `Europe/Moscow`. Manual runs use explicit start/end timestamps.
- Runtime: Node.js >=24, authenticated GitHub CLI, network access to GitHub and Slack.
- Git output: no repository changes. Posting the requested status message to the configured private Slack channel is explicitly authorized.
- Secret: `SLACK_BOT_TOKEN` in the automation environment. Present in the current interactive environment; not evidence that a future automation has access. Never copy its value to this record.
- Confirmed inputs: `STATUS_UPDATE_CHANNEL=C0CAR2WK43V`, initial `STATUS_UPDATE_SINCE=2026-10-20T00:00:00+03:00`, `STATUS_UPDATE_REPOSITORY=diffitask/ai-workshop-2026`. The first requested interval starts at yesterday's midnight in Moscow and ends at the current run start.
- Window: `[STATUS_UPDATE_SINCE, STATUS_UPDATE_UNTIL)`; capture end at run start. Persist the end only after confirmed delivery and reuse it as the next start. Configure durable state and serialize destination runs, or supply explicit non-overlapping windows manually. Do not assume an ephemeral checkout persists state.
- Delivery: one message with merged PRs and completed issues, exact UTC interval and counts. Slack bot must belong to the private channel and have `groups:read` and `chat:write`.
- Recovery: failed reads never post partial results. Failed/uncertain Slack writes require inspection before rerun. Dry runs never update the successful window.

## Activation checklist

In Air project → Automations, create the named automation with the prompt above, repository environment, user-selected schedule/timezone, and required inputs/secret. Ensure its state mechanism preserves the last confirmed end between runs. Record the actual automation URL, configured schedule, skill revision, manual run URL, and returned Slack channel/message timestamp here. Repository files and local tests alone do not establish activation.

## Local validation — 2026-10-21

- Skill frontmatter validation, all 94 repository tests (including seven status-update integration cases), and TypeScript checks passed.
- A read-only GitHub smoke check for `[2026-10-20T00:00:00.000Z, 2026-10-21T11:25:22.457Z)` found 19 merged PRs and four completed issues; the rendered preview was 2,735 characters.
- That smoke check did not send a Slack message. The channel and production interval were supplied later; the schedule remains user-managed. No Air automation/run URL exists for this setup.

## Confirmed manual delivery — 2026-10-21

- User-selected destination: private channel `C0CAR2WK43V`; bot membership, privacy and active status verified through Slack before posting.
- Delivered interval: `[2026-10-20T00:00:00+03:00, 2026-10-21T14:29:52.333+03:00)` (`Europe/Moscow`).
- One message with 19 merged PRs and four completed issues; Slack confirmed channel `C0CAR2WK43V` and message timestamp `1792582203.491649`.
- Next non-overlapping interval starts at `2026-10-21T11:29:52.333Z`. Configure this successful end in the automation's durable state when activating it; this documentation is not scheduler state.
- This was an interactive delivery using the requested skill, not an Air automation run. The user will set its schedule.
