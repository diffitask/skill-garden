Record a before/after demo for the triggering pull request in diffitask/ai-workshop-2026 and post it on that PR. Use the connected GitHub integration; do not ask for interactive input.

Read `spec/pr-demo.md` and `.agents/skills/pr-demo/SKILL.md` from the trusted default branch and follow the skill. Run the recorder and publisher from the default-branch checkout, never from PR code.

Resolve the PR number from the event payload or explicit manual input. Continue only if the PR is open and currently has the `AI: ready to merge` label; otherwise stop and say why. If the number is missing or ambiguous, stop with a clear run error.

Do not modify repository code, push commits, change labels, or merge. Posting the demo comment with uploaded images and videos is explicitly authorized. PR code runs only inside the recorder, which removes credentials from its environment; never export tokens to it.

Set `DEMO_REPOSITORY=diffitask/ai-workshop-2026`, the PR number, the full base and head SHAs, and `DEMO_RUN_URL` when the Air run URL is available (do not invent one). The publisher posts one demo per head commit; a relabel on the same commit is skipped. If recording fails before any video exists, do not publish an empty demo: report the failure in the run output. Never claim the demo was posted unless the publisher printed its URL. Finish with that URL, both SHAs, and the changed moments.
