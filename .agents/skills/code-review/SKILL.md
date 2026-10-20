---
name: code-review
description: Review code changes and produce short inline comments with precise locations and reproduction steps.
---

Review the diff and relevant surrounding code against the repository's specs and instructions. Report actionable bugs introduced by the changes.

Before reporting a finding, compare the relevant behavior at the PR base and head. Explain which change causes the failure and under what input or conditions it occurs; omit bugs that already exist at the base unless the PR makes them worse. Prefer running the same focused reproducer against both revisions when feasible and permitted; otherwise ground the comparison in code and label it as inferred.

Follow changed behavior into its affected callers and generated artifacts when the repository requires them to stay in sync. For a suspected mismatch, identify a concrete failing consumer or consistency check before reporting it.

Write short inline comments attached to the smallest relevant changed line range. Each comment must include:
- Where: file path and line number(s).
- What: the bug and its practical impact.
- How to reproduce: minimal setup, input or command, and steps, including expected versus actual behavior.

Support findings with code evidence or a reproducible check. Clearly label reproduction steps that were inferred rather than executed. Skip style-only feedback, speculative issues, and duplicates. If no actionable bugs are found, say so briefly. Do not modify the code during review.
