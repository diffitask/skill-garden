# PR Demo – ai-workshop-2026

Repository: `diffitask/ai-workshop-2026`.
Activation: not configured by this session. Validate one manual run before enabling automatic triggers. No live Air automation management tool is available in this session.

- Skill: `.agents/skills/pr-demo/SKILL.md` and trusted helper `.air/scripts/publish-pr-demo.mjs`.
- Instructions: `Use the pr-demo skill to demonstrate the triggering PR. For a manual run, use the supplied PR number or the sole open PR labeled AI: review passed. Publish the verified video and English report on that PR. Do not modify application code or merge.`
- Environment: Node >=24, npm, authenticated GitHub CLI for publication, Chromium/Playwright with video support; optional video editing tools. Do not expose credentials to PR application processes.
- Primary trigger after validation: `PR labeled`, Label name `AI: review passed`. A polling fallback may scan eligible open PRs every approximately ten minutes if the UI supports that interval, but requires enforced serialization or atomic coordination first. The current helper's marker check is not a distributed lock.
- Output: no application commits. Prefer durable PR-readable attachments with `No code changes`. If no such attachment exists, select a mode that permits dedicated evidence-branch publication and explicitly restrict pushes to sanitized evidence, as in the Red Agent workflow. A blanket no-push restriction blocks that fallback.
- Do not assume event triggers process already-green PRs; run those manually. Check current revisions and label before recording and publishing. Never change green labels to force a demo.

## Manual validation

- Completed an interactive manual run on 2026-10-21 for [PR #26](https://github.com/diffitask/ai-workshop-2026/pull/26), base `badedeb24d2ec434dc7966510d69fed71bccbf96`, head `d9000bc0cb769db10675087efabbe3bf417dc851`.
- Published and read back the [demo comment](https://github.com/diffitask/ai-workshop-2026/pull/26#issuecomment-6316097947). PR remained open at the same head with `AI: review passed` after publication.
- [48.28-second H.264 video](https://github.com/diffitask/ai-workshop-2026/blob/4d61aa3ad9ab73e4c86cf4a4644c689204ac2e25/demo.mp4), 1280 × 900, Chromium 156.0.8078.4. Captions, pointer and result highlights compare the same actions on base/head, then show re-clustering the previously unsent skills.
- Five asserted states include the baseline's misleading conclusion, the fixed unsent count, suppression of that conclusion for unsent skills, and the evaluated result after a new request. Reviewed representative video frames. The server UI, scanner and model-answer validator ran unchanged against disclosed replayed GitHub transport and a model stub; no live Claude behavior was tested. Server view recorded; the PR's existing responsive browser tests passed for both server and portable views.
- Sanitized evidence only is committed on `air/pr-demo-26-20261021-123654` at `4d61aa3ad9ab73e4c86cf4a4644c689204ac2e25`. [Reproduction and observations](https://github.com/diffitask/ai-workshop-2026/blob/4d61aa3ad9ab73e4c86cf4a4644c689204ac2e25/README.md). No application branch was pushed.
- The repository is private: verified the video, preview and reproduction bytes against local SHA-256 through the authenticated GitHub Contents API. Anonymous URLs correctly return 404; commit-pinned links inherit repository access. The preview uses a same-repository blob URL with `?raw=true`, which GitHub's Markdown renderer recognizes as an image; actual rendering for another signed-in reviewer was not independently observed. Use View raw / Download if the video player is unavailable.
- Validation: skill frontmatter validator passed; all 96 local tests (including nine demo-publisher tests), TypeScript checks and the PR's two Chromium responsive tests passed. The helper revalidated target eligibility and read back the exact published comment. This was a serial interactive run, not an Air Run Now or a verified event-triggered run. Automatic triggers remain unconfigured; serialization remains required before overlapping automatic runs.
