# AI clustering filter transition reproduction

Application SHA: badedeb24d2ec434dc7966510d69fed71bccbf96.
Chromium 156.0.8078.4; viewport/video 1280 × 900 CSS pixels.

This is a disclosed deterministic fixture, not a live GitHub organization or live Claude run. It uses the existing organizationFixture transport recording: Example/alpha at alpha-commit and Example/zebra at zebra-commit, each containing same-name and aaa-elsewhere. One repository fails and one is empty. GitHub transport alone is replayed, including browser CORS exposure of Link. The unchanged real server, scanner, parser, model-answer validator, portable bundle and UI run. The model dependency returns a delayed valid cluster of s1 and s2 so UI transitions can be reproduced without Claude credentials. The fixed pairing string is fixture-only and grants no access outside this short-lived test server.

From the repository root on this evidence commit:

```bash
npm ci
npx playwright install --with-deps chromium
AIR_ARTIFACTS_DIR=/tmp/red-agent-reproduction node evidence/c6cb8289/explore.mjs
```

The script creates its output directory. It starts its own isolated server on a free loopback port. For each view it opens two fresh browser contexts, scans the populated partial organization, filters to same-name, requests AI clustering, clears the filter while waiting, and observes the completed result. It then filters to elsewhere, checks selection/document retention and replacement, and starts a new scan while another answer is pending. No application code is modified. No live API or model is called.

Expected: when four skills are shown and only two belong to the cached AI result, the other two are accounted for as not clustered or explicitly not yet evaluated. Filtering to the two omitted skills must not claim Claude evaluated them.

Observed in both fresh runs in each view: four skills shown, two cluster members, no unclustered count. Filtering to elsewhere shows two skills, zero AI clusters, no unclustered count, and “Claude found no clusters among these skills.” Those two skills were never included in the request.

The videos show the full setup and state transition. Use View raw / Download if GitHub does not display a player. Screenshots supplement the videos. replay.json records every synthetic GitHub response; explore-results.json contains observations from both attempts in both views.

Produced by Air Automations. Name: Red Agent / Run: https://air.jetbrains.cloud/org/05cf1a7f-6ab5-713b-abd3-29d0c8a05e2d/automations/2673eb42-0e3a-45ea-82db-cc0f23f4d6ad?run=c6cb8289-b78a-4223-b9b7-625b1467296f
