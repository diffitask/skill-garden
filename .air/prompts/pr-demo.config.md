# PR demo – ai-workshop-2026

This is a human-readable configuration record, not an automatically applied Air DSL.

- Purpose: when a PR is labeled `AI: ready to merge`, record the web view at the PR base and head and post both videos plus highlighted before/after screenshots on the PR.
- Repository: https://github.com/diffitask/ai-workshop-2026. Load the prompt, skill, recorder, and publisher from the default branch.
- Air prompt: `Follow instructions from .air/prompts/pr-demo.md`.
- Trigger: GitHub PR labeled, filtered to the label `AI: ready to merge`; manual runs take a PR number. If Air offers no label filter, trigger on PR labeled events and let the prompt stop when the label is absent. If Air has no label event at all, use a schedule (every 15 minutes) whose run lists open PRs with the label and runs the skill for each one; the publisher's per-head marker prevents duplicates.
- Runtime: Node.js >=24, Git, GitHub CLI >=2.99 (`--attach`), `ffmpeg`, Playwright Chromium and system libraries (`npx playwright install --with-deps chromium`), access to api.github.com, github.com, uploads.github.com, the npm registry, and the Playwright CDN (or `storage.googleapis.com` as the documented fallback).
- Access: read PRs, contents, and comments; create comments with uploaded attachments. Uploading requires write access to the repository for the connected identity. No webhook or extra secrets.
- Git output: no code changes. Comment publication is explicitly authorized by the prompt.
- Delivery: one new comment per head commit with marker `<!-- air-pr-demo:<head-sha> -->`. New commits followed by relabeling produce a new demo; previous demo comments are kept. No automatic retries.
- Label: `AI: ready to merge` exists in the repository (created 2026-10-20). Removing and re-adding it on the same head is a no-op unless the run sets `DEMO_FORCE=1`.
- Activation record: NOT YET CONFIGURED OR VERIFIED in Air. After applying, record the automation URL and the merged instruction revision, and the first delivered comment URL.
