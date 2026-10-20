---
name: code-review
description: Review code changes and produce short inline comments with precise locations and reproduction steps.
---

Review the diff and relevant surrounding code against the repository's specs and instructions. Report actionable bugs introduced by the changes.

Write short inline comments attached to the smallest relevant changed line range. Each comment must include:
- Where: file path and line number(s).
- What: the bug and its practical impact.
- How to reproduce: minimal setup, input or command, and steps, including expected versus actual behavior.

Support findings with code evidence or a reproducible check. Clearly label reproduction steps that were inferred rather than executed. Skip style-only feedback, speculative issues, and duplicates. If no actionable bugs are found, say so briefly. Do not modify the code during review.
