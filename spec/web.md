# Local web view
- `npm start` serves Skill Atlas at `http://127.0.0.1:3000`; `PORT` overrides the port.
- Enter a GitHub repository URL and submit to scan its default branch using the existing scanner. `GITHUB_TOKEN` stays on the server.
- Show the repository, skill count, and skills sorted by name with descriptions. Select the first skill initially; selecting another shows its name, description, path, full original SKILL.md as plain text, and a GitHub link pinned to the scanned commit.
- Reuse file reads from the scan to show contents without fetching each file again. Store nothing on disk.
- Show progress while loading and prevent duplicate submissions. Clear old results on a new scan.
- Show an explicit empty state for no skills, scan warnings, and clear errors for invalid URLs, unavailable repositories, or GitHub rate limits. A failed scan can be retried.
- Serve the page, script, and stylesheet locally. Repository text is displayed as text, never executable markup. Support narrow screens and keyboard navigation.

## Portable page
- `npm run build:web` produces a self-contained `skill-atlas.html` to open directly in a browser. No server, port forwarding, CDN scripts, or package installation is needed to use the generated file.
- The portable page scans public GitHub repositories directly using the same scanner, without a token. An internet connection is required; API failures and rate limits appear in the page.
- Include styles, scanner, parser, and interaction code in the HTML. It supports skill selection and full original document contents, just like the server view.

- Both views use the analysis rules for skill copies and test data: copies count as one skill, and test data is excluded from the skill list and file reads. Regenerate the portable HTML whenever the scanner changes.
