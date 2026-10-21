# PR #26: changes in action

This 48-second annotated video demonstrates the real Skill Atlas server UI before and after PR #26. No application source was changed to record it. Captions, a pointer and outlines are separate explanatory overlays.

- Repository: diffitask/ai-workshop-2026.
- Base: badedeb24d2ec434dc7966510d69fed71bccbf96.
- Head: d9000bc0cb769db10675087efabbe3bf417dc851.
- Chromium 156.0.8078.4; viewport/video 1280 × 900.
- GitHub responses are replayed from the repository's organization fixture. Model responses are deterministic stubs passed to the existing server's dependency injection. This tests the real scanner, answer validator and UI, not live GitHub or Claude.
- The recorded view is the server view. The PR's two existing responsive Chromium tests also passed for server and portable views; those tests are not additional recordings of this workflow.

## Watching guide

- 00:00 — context: four skills, only two sent to the model.
- 00:04 — before: cluster a filtered subset and clear the filter while the answer is pending.
- 00:15 — before: filter to the two unsent skills; the UI incorrectly attributes a no-clusters conclusion to Claude.
- 00:22 — after: repeat exactly the same actions with the fixed revision.
- 00:32 — after: the UI explicitly counts the unsent skills and prompts the user to cluster again.
- 00:40 — cluster again: only after evaluation does “Not in a cluster” describe a model result.

`demo.mp4` is the final H.264 video. If GitHub does not display a player, use View raw / Download. `preview.png` shows the corrected state. `observations.json` contains asserted outcomes and caption timestamps.

## Reproduce

Create separate detached checkouts for the two revisions above and run `npm ci` in each. Install Chromium and system dependencies using `npx playwright install --with-deps chromium`. Download this evidence directory, then run:

```bash
node record.mjs /path/to/base-checkout /path/to/head-checkout /path/to/output-directory
```

The recorder launches isolated fixture servers with a restricted environment, records real Chromium interactions, asserts the before/after states and writes a WebM plus screenshots and observations. It loads only the attached replay and uses no GitHub or model credentials. For MP4 conversion:

```bash
ffmpeg -i /path/to/output-directory/pr-26-demo.webm -c:v libx264 -crf 23 -pix_fmt yuv420p -movflags +faststart -an demo.mp4
```
