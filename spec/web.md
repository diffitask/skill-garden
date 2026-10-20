# Local web view
- The primary web view is a persistent local HTTP server, started with `npm start` or `./skill-atlas web` from any working directory. It prints `http://localhost:3000` and binds to loopback locally. In Air cloud it binds to `0.0.0.0` and prints the public URL from `JBCENTRAL_EXPOSED_PORT_URL_<port>` when available; otherwise it explains that the port must be exposed in a new cloud task. `HOST` overrides the bind address and `PORT` overrides the port. No HTML download or build step is required.
- Keep the process running and reuse the same URL, including after a page reload. Ctrl+C stops it. Serve all assets and scan requests through the local server.
- Invalid ports fail with a clear message and exit code 1; an occupied port explains how to stop the other server or choose another port. `PORT=0` chooses a free port and prints its actual number.
- Enter a GitHub repository URL and submit to scan its default branch using the existing scanner. `GITHUB_TOKEN` stays on the server.
- Show the repository, skill count, and skills sorted by name with descriptions. Select the first skill initially; selecting another shows its name, description, path, full original SKILL.md as plain text, and a GitHub link pinned to the scanned commit.
- Reuse file reads from the scan to show contents without fetching each file again. Store nothing on disk.
- Show progress while loading and prevent duplicate submissions. Clear old results on a new scan.
- Show an explicit empty state for no skills, scan warnings, and clear errors for invalid URLs, unavailable repositories, or GitHub rate limits. A failed scan can be retried.
- Display a decorative pink flower beside Skill Atlas in the header, embedded in both views and hidden from assistive technology.
- Serve the page, script, and stylesheet locally. Repository text is displayed as text, never executable markup. Support narrow screens and keyboard navigation.

## Portable page
- `npm run build:web` produces a self-contained `skill-atlas.html` to open directly in a browser. No server, port forwarding, CDN scripts, or package installation is needed to use the generated file.
- The portable page scans public GitHub repositories directly using the same scanner, optionally with a GitHub personal access token. An internet connection is required; API failures and rate limits appear in the page.
- Include styles, scanner, parser, and interaction code in the HTML. It supports skill selection and full original document contents, just like the server view.

- Both views use the analysis rules for skill copies and test data: copies count as one skill, and test data is excluded from the skill list and file reads. Regenerate the portable HTML whenever the scanner changes.

## Scan failures and rate limits
- A failed scan shows a prominent red error panel with an alert role, focus, a clear heading, and a Try again button. Progress and successful completion remain in the status line.
- For rate limits, explain that GitHub temporarily limited requests. In the portable page, offer waiting or adding a token through an Add GitHub token button that focuses the visible token field. Do not tell HTML users to set an environment variable.
- GitHub access is available only in the portable page: an always-visible password field labeled GitHub token (optional) below the repository field, a link to create a token, and a statement that it is sent only to GitHub and never saved. Keep it in the current tab only, never in storage, URLs, generated HTML, or error messages.
- Optional browser tokens authenticate GitHub API requests while keeping tree discovery (no code search). Public file contents are fetched without the token. Without a token, anonymous scans still work when GitHub allows them.
- After supplying a token, Try again repeats the scan of the entered repository and clears the error on success. A rejected token has an actionable message; an exhausted authenticated limit asks the user to wait rather than promising a token will bypass it.
- The server view keeps its token on the server and gives server-specific rate-limit guidance.

## Readable skill summary
- Show a prominent skill name and GitHub link above a summary split into titled blocks. The first descriptive sentence is What it does; additional descriptive sentences are Details. Explicit Use when/for/to clauses appear under When to use, and explicit compatibility or caution clauses under Compatibility & cautions. Omit empty blocks.
- Preserve the original wording, version numbers, and every sentence. Recognize a caution clause after a semicolon (for example, “for older 0.x versions”) without inventing requirements or summaries. Unrecognized prose stays in What it does / Details.
- Use larger text and a highlighted background for What it does, separate cards for usage and cautions, and a single-column layout on narrow screens. Render all description content as plain text.
- Put the unmodified document and path in an expandable Full SKILL.md section, collapsed initially and when changing skills. Missing descriptions show an explicit fallback pointing to the full document.
