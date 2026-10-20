# Automated PR review
- The Code review GitHub Actions workflow reviews same-repository PRs when opened, reopened, updated, or marked ready, using `.agents/skills/code-review/SKILL.md`.
- A manual workflow dispatch accepts an open same-repository PR number, including PRs created before the workflow was installed. The workflow must first be merged into the default branch.
- Configure the `OPENAI_API_KEY` repository Actions secret. Fork PRs do not receive this secret and are excluded from automatic review.
- Review the actual base-to-head diff without executing PR code. Review generation has read-only repository permissions; a separate job publishes its result with comment permissions.
- Publish one Markdown PR comment containing findings with locations and reproduction steps, or a brief statement that no actionable bugs were found. Include a workflow link. On subsequent runs update the bot's existing marked comment; ignore matching markers authored by other users.
- If the API key is missing, publish setup guidance. If review generation fails or returns empty output, publish a failure notice rather than claiming the review passed. Bound oversized output to GitHub's comment size limit and disclose truncation.
