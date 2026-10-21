# Web red agent

- `.agents/skills/red-agent/SKILL.md` guides browser exploration of the local and portable web views against the specs, including narrow screens, keyboard use, scan/filter/selection, errors and clustering.
- Reproduce each real user-visible failure twice before filing. Do not modify application behavior during discovery or report environment failures as product bugs. Bound each run to 20 minutes and three new issues; no confirmed bugs is a valid reported outcome.
- One English GitHub issue per distinct bug, deduplicated against open/closed issues and fix PRs. Include application revision, view/browser/viewport, public prerequisites or attached deterministic replay, numbered steps, expected/actual results, impact, and a durable browser-video URL. No secrets or session-local evidence links.
- Apply the exact `Delegated to AI` label and read back the published issue/evidence. Report publication failures honestly and inspect uncertain writes before retrying.
- Air configuration and activation evidence live in `.air/prompts/red-agent.config.md`. Repository files do not create a live automation. The discovery prompt is `Follow instructions from .agents/skills/red-agent/SKILL.md.`
- A separate live issue-to-PR consumer of the label is required for automatic fixes; it reproduces the issue, updates specs and integration coverage, runs local checks, and opens a linked PR without merging. Do not confuse label application or an interactive fix with verified automatic delivery.
- Validate the discovery skill with a real manual browser run and read back any created issues. Validate the automatic loop only with actual Air run links and a linked fix PR from the issue consumer.
