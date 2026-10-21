---
name: red-agent
description: Exercise the Skill Atlas web views in a real browser, reproduce bugs, and file one GitHub issue per bug with steps, a video, and the Delegated to AI label.
---

Find real user-visible failures in the web view. This run is authorized to publish bug issues and their reproduction evidence in the current GitHub repository. Leave fixes to the issue-to-PR automation.

## Explore and reproduce

- Read AGENTS.md and spec/ first. Inspect the checkout, revision, remote, existing issues and open PRs. Use the connected GitHub identity; keep GitHub-facing text in English.
- Install dependencies with `npm ci` when needed. Start `npm start`; also exercise the generated `skill-atlas.html` directly in a browser. Use available browser tooling; Playwright with Chromium and video recording is an alternative when no browser tool is exposed.
- Try actual user workflows: scan repositories and organizations, select and filter skills, use keyboard navigation, recover from errors, change cluster controls, and resize to narrow screens. Cover both views where behavior is shared. Do not deliberately introduce defects or edit application code.
- Compare observed behavior with the spec. Require a concrete user impact and repeat the failure from a clean page before filing. Distinguish application defects from unavailable credentials, upstream outages, rate limits, or missing browser dependencies. Do not invent a bug to meet a quota.
- Prefer public reproducible inputs. If a deterministic network replay is necessary, attach its data and exact replay command, and disclose the substituted responses. Never mock the behavior claimed to be broken.
- Spend at most 20 minutes exploring and file at most three new bugs per run. Zero confirmed bugs is a valid outcome; report what was tested.

## Evidence and one issue per bug

- Record a short browser video showing the setup, triggering interaction and visible failure. Record the viewport, browser version, scanned repository/commit and application SHA. Keep screenshots/logs/replay scripts under `AIR_ARTIFACTS_DIR` when available. Do not record tokens or pairing codes.
- Put the video at a durable URL readable by issue readers. Use the environment's artifact attachment mechanism when it supplies such a URL. Otherwise publish only sanitized reproduction evidence on a dedicated `air/red-agent-evidence-<run-id>` branch in this repository and link to the commit-pinned video. Never put local paths, expiring session URLs or secrets in an issue. A screenshot is supplementary, not a substitute for video.
- Search open and closed issues and linked PRs for the same triggering input and failure. Skip an existing report; report its URL in the run result. Do not create another issue to retrigger a failed fix.
- File each distinct confirmed bug separately, with: a specific title; tested application SHA and view; prerequisites and numbered steps; expected and actual results; user impact; the durable video link; and minimal supporting logs/replay commands if needed. Steps must suffice without this run's private context.
- Create with the exact label `Delegated to AI` (and `bug` when available). Verify the issue body, evidence URL and labels by reading it back. This label routes work only when a matching live issue-to-PR automation exists; it does not implement a fix by itself.
- On an uncertain GitHub write, read GitHub state before any retry. Stop on access failures and report the precise failed action without claiming publication.

Return the issue URLs with a sentence describing each confirmed failure, evidence links, and any blockers. Report linked fix PRs only after verifying them on GitHub. Never claim that an automation ran or a fix arrived based solely on repository configuration files.
