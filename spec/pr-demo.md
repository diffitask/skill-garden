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
- A scenario is JSON: `{ title?, viewport?, steps: [...] }`. Actions are `goto`,
  `click`, `type` (clicks the field, then types visibly), `fill` (instant setup),
  `press`, `wait` (a selector, optionally with `text`, or milliseconds), `scroll`
  and `pause`. The viewport is fixed per scenario: a `viewport` step is rejected,
  because the video frame keeps its size and a resized page shrinks into a corner.
- Steps may carry `note`, a hint of at most 90 characters shown as a caption
  (`beforeNote` replaces it in the base); `focus`, a selector for the part the PR
  changes; `moment`, a key moment; and `afterOnly`, for steps that need the new
  feature. In the base, a run of `afterOnly` steps is skipped once with an
  explanatory caption, and its moments are `new`.
- The video is paced for watching without pausing: a title card with the revision,
  a visible cursor gliding to each target and pausing on it before a click ripple,
  visible typing, smooth scrolling, captions held long enough to read, and a
  revision badge in the corner. At a step with `focus`, the element is scrolled
  into view, the rest of the page is dimmed, and a red outline is drawn around it
  with a "Changed by this PR"/"Before this PR" tag, held for at least 3 seconds.
  The overlay uses constructed stylesheets, so the app's CSP need not be relaxed.
- A step that fails in a revision (for example, a selector the base does not have)
  is recorded as unavailable for that revision with its error and a caption, and
  the scenario continues. If a revision's server does not start, it has no video
  and every moment is unavailable; the other revision is still recorded.
- Each revision produces one video, `before.mp4` and `after.mp4` (H.264 through
  `ffmpeg`, or Playwright's `.webm` when `ffmpeg` is missing).
- Moments are screenshots at 2x with the overlay hidden, numbered in order, and
  compared pixel by pixel (regions in CSS pixels): `changed`, `unchanged`, `new`, or
  `unavailable`. Highlighting follows intent, not every pixel: the `focus` box, or,
  without one, the detected change when it is a single area under 40% of the screen
  (marked as automatic). Changes outside the focus are counted, not outlined.
- A moment that is not unchanged gets one image: its number, name, and hint;
  Before | After overviews with the rest of the page dimmed and one numbered red
  outline; then close-ups of the same area in both revisions, enlarged so they stay
  readable when GitHub shrinks the image. A missing side says why ("Not present
  before this PR", or the error). `manifest.json` lists videos, moments, focus
  boxes, regions, and step results.
- The publisher `.air/scripts/pr-demo/publish.mjs <out-dir>` takes `DEMO_REPOSITORY`,
  `PR_NUMBER`, `PR_HEAD_SHA`, `PR_BASE_SHA`, and optionally an HTTPS `DEMO_RUN_URL`.
  It publishes only when the PR is open, still at the recorded head, and still has
  the label. One demo per head: a comment with `<!-- air-pr-demo:<head> -->` already
  present skips publication unless `DEMO_FORCE=1`.
- The comment shows both commits, a numbered "What to look at" list matching the
  image numbers, one section per moment with its hint, image, and a note about
  automatic outlines or other changed areas, the unchanged moments in one line, and
  both videos as players. Files are uploaded with `gh pr comment --attach` (gh >= 2.99). Missing
  videos are stated rather than omitted silently. GitHub failures propagate
  without retrying.
- Integration tests cover PNG encoding, region detection, the fake GitHub, scenario
  validation, a full recording with changed, new, unchanged, and unavailable
  moments, focus and automatic outlines, overlay-free screenshots, a failing revision,
  credential isolation, and every publication and skip case.
