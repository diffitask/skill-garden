# PR #26: revised demonstration

40-second browser demonstration of the same bug fix, with lightweight annotations beside the relevant UI and separate Before / After chapter cards. There are no persistent top/bottom banners. Each chapter uses the same quiet solid background, a brief summary and a gentle fade.

- Base: badedeb24d2ec434dc7966510d69fed71bccbf96.
- Head: d9000bc0cb769db10675087efabbe3bf417dc851.
- Presentation revision: 2. The previous demo comment and its immutable video remain intact.
- Real Chromium 156.0.8078.4; 1280 × 720; server view.
- GitHub transport is replayed; model responses are stubbed through the existing server's dependency injection. The scanner, model-answer validator and product UI run unchanged. This is not a live GitHub or Claude test. Disclosure appears on the chapter cards and in the PR report.

## Viewing guide

- 00:00 — Before: a model conclusion is shown for skills never sent to the model.
- 00:03 — send only the two filtered skills, then clear the filter while the answer is pending.
- 00:11 — show only unsent skills: the original UI incorrectly says Claude found no clusters.
- 00:17 — After: repeat the same actions on the fixed revision.
- 00:28 — unsent skills are explicitly marked and can be included with another request.
- 00:35 — after that request, Not in a cluster describes an actual evaluated result.

`demo.mp4` is the final H.264 video. Use View raw / Download if GitHub does not display a player. Evidence remains in this private repository and requires repository access. `preview.png` shows the fixed state; `before-card.png` and `after-card.png` show the chapter transitions. `observations.json` records five asserted application states and raw capture timestamps; `video.json` maps them to the final timeline.

## Reproduce

Create separate detached checkouts at the base/head revisions above and run `npm ci` in each. Install Chromium and system libraries with `npx playwright install --with-deps chromium`. Download this evidence directory, then run:

```bash
node record.mjs /path/to/base-checkout /path/to/head-checkout
python finalize.py
```

The recording script launches isolated fixture servers with a restricted environment. It uses the attached replay and model stub, drives the real Chromium UI, checks actual before/after outcomes and produces a WebM. `annotations.mjs` is copied from the trusted pr-demo skill. Its visual overlay does not modify product text, layout or click behavior. `finalize.py` uses FFmpeg to remove setup/navigation between chapters and encode the final MP4 without changing the demonstrated application results.
