# Code Review – ai-workshop-2026

This is a human-readable configuration record, not an automatically applied Air DSL.

- Purpose: review PR changes and deliver a concise GitHub comment using the repository's code-review skill.
- Owner: repository maintainer (diffitask); an Air project administrator applies the configuration.
- Repository: https://github.com/diffitask/ai-workshop-2026. Load the prompt, skill, and publisher from the default branch; resolve base/head from the triggering PR.
- Air prompt: `Follow instructions from .air/prompts/pr-review.md`.
- Trigger: GitHub PR opened, new commits (synchronize), and ready for review, targeting this repository. Use one trigger per event to avoid duplicate runs. For manual runs provide the PR number.
- Runtime: the project's centrally authenticated coding agent and model; environment with Node.js >=24, Git, GitHub CLI, and access to api.github.com and github.com. No OPENAI_API_KEY is required for this Air route.
- Access: Air's GitHub App must be installed with this repository allowed, and the environment must expose authenticated GitHub CLI access for reading PRs and creating/updating comments. Do not assume that read access implies comment access. Validate both before enabling the trigger.
- Git output: no code changes. Comment publication is explicitly authorized by the prompt; validate that the selected Air environment/output combination permits it. Some existing team reviewers use push-to-source output with an explicit no-push prompt: do not copy that setting blindly or allow code pushes.
- Delivery: one marked bot comment, with reviewed SHA, findings or a brief no-findings result, and run link when available. Subsequent runs update it. No messages to Slack or YouTrack.
- Limits/recovery: use the project's existing run limits. Skip stale/closed PRs; do not retry failed writes automatically. A human fixes access and reruns for the current head. Pause by disabling the PR trigger.
- Setup: Air project → Automations → create this automation (or edit the existing reviewer) → choose the repository environment → paste the prompt above → configure the PR triggers. Settings → Integrations must include this repository. If Automations is missing, consult the internal troubleshooting guide.
- Activation record: NOT YET CONFIGURED OR VERIFIED in Air. After applying, record the automation URL/configuration version and corresponding Git revision here. Validate PR #8 (if still open), record the run URL, reviewed SHA, delivered comment URL, and any remaining gap.

Sources:
- https://youtrack.jetbrains.com/articles/LME-A-22 — team convention for versioned prompts and explicit delivery permissions.
- https://youtrack.jetbrains.com/articles/AIR-A-14 — GitHub integration, environment access, and troubleshooting.
- https://youtrack.jetbrains.com/articles/AIAC-A-1 — centrally funded Air usage; Central/TeamCity for CI-native workflows.
- https://youtrack.jetbrains.com/articles/JBAI-A-1156 — LiteLLM agent setup is historical; use Central for supported agents.

## Delivery validation (2026-10-20)
- Ran the publisher locally using the current session's GitHub authentication on PR #8 at head `7e600dd601681a34204c8757ec2837829fe32fcb`.
- Delivered comment: https://github.com/diffitask/ai-workshop-2026/pull/8#issuecomment-6289565282.
- This validates GitHub CLI publication, not an Air event trigger, Air authentication, central model access, or a complete automated review run. Air activation remains pending.
