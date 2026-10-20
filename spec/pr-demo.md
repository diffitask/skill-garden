# PR demo: before/after recording

- Adding the label `AI: ready to merge` to an open PR starts the Air automation in
  `.air/prompts/pr-demo.config.md`. It follows `.air/prompts/pr-demo.md` and the
  `pr-demo` skill, loaded from the trusted default branch, never from PR code.
- The recorder `.air/scripts/pr-demo/record.mjs` runs the same scenario against the
  web view at the PR base and at the PR head: `--before-ref`/`--after-ref` check out
  temporary worktrees of `--repo` and run `npm ci --ignore-scripts` there, or
  `--before`/`--after` take prepared directories. `--out` receives the results.
- Each revision runs `node src/server.ts` on a free local port. GitHub is replaced
  by a trusted fake (`fake-github.mjs`, preloaded with `--import`), so the
  recording is offline and deterministic: `https://github.com/demo/skills` serves
  the trusted `fixture/` directory, `demo/missing` is not found, `demo/limited` is
  rate limited. Anything else is refused rather than reaching the network.
- PR code is untrusted. Its install, server, and browser page get only `PATH`, a
  temporary `HOME`, `PORT`, and the fake's settings: no GitHub, Air, or webhook
  credentials. Installation additionally gets proxy and CA settings, never ones
  with embedded credentials; the app itself has no network beyond the fake.
  Lifecycle scripts never run during installation. Worktrees are removed afterwards,
  also when installation or recording fails.
- A scenario is JSON: `{ viewport?, steps: [...] }`. Actions are `goto`, `fill`,
  `click`, `press`, `wait` (a selector or milliseconds) and `viewport`. A step with
  `moment` is a key moment: after it, a viewport screenshot is taken with the caption
  hidden. `scenario.json` is the default; a PR-specific scenario may be passed with
  `--scenario`. While recording, a caption shows the revision and current step.
- A step that fails in a revision (for example, a selector the base does not have
  yet) is recorded as unavailable for that revision with its error, and the scenario
  continues. If a revision's server does not start, it has no video and every moment
  is unavailable; the other revision is still recorded.
- Each revision produces one video, `before.mp4` and `after.mp4` (H.264 through
  `ffmpeg`, or Playwright's `.webm` when `ffmpeg` is missing).
- For each moment, before and after screenshots are compared pixel by pixel.
  Changed pixels are grouped into padded rectangles; images of different sizes
  count the extra area as changed. A changed moment produces a side-by-side
  `Before | After` image with the changed regions outlined on both halves;
  identical moments are reported as unchanged. `manifest.json` lists the videos,
  moments, regions, and step errors.
- The publisher `.air/scripts/pr-demo/publish.mjs <out-dir>` takes `DEMO_REPOSITORY`,
  `PR_NUMBER`, `PR_HEAD_SHA`, `PR_BASE_SHA`, and optionally an HTTPS `DEMO_RUN_URL`.
  It publishes only when the PR is open, still at the recorded head, and still has
  the label. One demo per head: a comment with `<!-- air-pr-demo:<head> -->` already
  present skips publication unless `DEMO_FORCE=1`.
- The comment shows both commits, the changed moments with their before/after
  images inline, the unchanged and unavailable moments by name, and both videos as
  players. Files are uploaded with `gh pr comment --attach` (gh >= 2.99). Missing
  videos are stated rather than omitted silently. GitHub failures propagate
  without retrying.
- Integration tests cover PNG encoding, region detection, the fake GitHub, a full
  recording with changed, unchanged, and unavailable moments, a failing revision,
  credential isolation, and every publication and skip case.
