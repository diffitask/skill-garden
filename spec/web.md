# Local web view
- `npm start` serves Skill Atlas at `http://127.0.0.1:3000`; `PORT` overrides the port.
- Enter a GitHub repository URL and submit to scan its default branch using the existing scanner. `GITHUB_TOKEN` stays on the server.
- Show the repository, skill count, and skills sorted by name with descriptions. Select the first skill initially; selecting another shows its name, description, path, full original SKILL.md as plain text, and a GitHub link pinned to the scanned commit.
- Reuse file reads from the scan to show contents without fetching each file again. Store nothing on disk.
- Show progress while loading and prevent duplicate submissions. Clear old results on a new scan.
- Show an explicit empty state for no skills, scan warnings, and clear errors for invalid URLs, unavailable repositories, or GitHub rate limits. A failed scan can be retried.
- Display a decorative pink flower beside Skill Atlas in the header, embedded in both views and hidden from assistive technology.
- Serve the page, script, and stylesheet locally. Repository text is displayed as text, never executable markup. Support narrow screens and keyboard navigation.
- Both views provide an accessible field labeled Filter skills for current results. Apply
  the word-filter rules in [analysis.md](analysis.md) immediately on input, without rescanning,
  file reads, or network requests. Show matching and total skill counts, preserving order,
  deduplication, links, and scan warnings. Clear the filter when starting a new scan.
  Organization results hide repositories without matches while filtering; repository and
  group headings count matching skills, while the scan summary and test data stay unchanged.
- Keep the selected skill and its expanded document if it still matches; otherwise select
  the first match and collapse its document. With no matches, show No skills match your filter,
  clear and hide the detail pane, and keep the filter available. Clearing the filter restores
  all skills and selects the first if selection was cleared. Tab/Enter and Arrow Up/Down,
  Home/End navigation work with the matching list. A repository with no skills retains its
  distinct No skills found state.
- Both views show a **Skill clusters** section above the skill list (see *clusters* in
  [analysis.md](analysis.md)), with the cluster count and a Cluster similarity selector of the
  levels with their cluster counts: Loose for results under 50 skills, else Balanced. Each
  cluster card shows its label words and its member skills as buttons; selecting one selects
  that skill in the list, like a click there. The filter limits clusters to matching members and
  hides clusters without any. Clusters are computed once per scan; changing the level or filter
  never rescans. Without clusters, show No skills share enough words to form a cluster. Show
  how many shown skills are not in a cluster. Hidden with no matches; reset on a new scan.
- **AI clusters**: beside the word clusters (Without AI, left), a With AI panel (right; stacked on
  narrow screens) clusters the shown skills with Claude Haiku 4.5 (`claude-haiku-4-5`) on request:
  a Cluster with AI button naming the skill count, explaining that names and descriptions are sent
  to Claude. The local server runs the Claude Code CLI in headless mode (`claude -p`, or
  `CLAUDE_BIN`) with structured JSON output, a dedicated system prompt, no tools, no session
  persistence, the prompt on stdin and no shell; at most 400 skills, descriptions cut to 400
  characters; skills are keyed `s1`, `s2`… in the prompt. `POST /api/ai-clusters` takes
  `{"skills": [{id, name, description}]}` as JSON (other content types, malformed or oversized
  bodies: 400; other methods: 405).
- The model's answer is validated, never trusted: unknown keys are ignored, a skill stays in its
  first cluster, clusters need two skills, labels are plain text of at most 60 characters. Order
  like the word clusters; the rest are not in a cluster. Show progress and disable the button
  while waiting; show a missing CLI, a login error, a timeout, or a malformed answer as an alert in
  the panel, retryable. The filter limits shown AI clusters as for word clusters. A new scan
  discards AI clusters and ignores a late answer.
- The portable page has no CLI; it asks a paired local **AI helper**, the `npm start` server, in the
  same window. Its With AI panel adds an AI helper address field (`http://127.0.0.1:3000` by
  default) and a Pairing code password field, kept in the current tab only, never in storage,
  URLs, or HTML. The button stays disabled without a code. An unreachable helper, an invalid
  address, and a rejected code each give an actionable alert.
- `npm start` prints a random pairing code (`SKILL_ATLAS_AI_CODE` overrides it). The AI endpoint
  answers CORS preflights, including Chrome's private-network request, and readable responses for
  any origin, but runs Claude only for: no Origin (a local tool), its own page (Origin equals
  `http://` + Host, with a `127.0.0.1` or `localhost` Host, so rebound DNS names fail), or a matching
  `X-Skill-Atlas-Code` header, compared in constant time; otherwise 403. One clustering runs at a
  time per server; a concurrent request gets 429.

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

## Organizations in both views
- The existing input accepts a GitHub repository URL or organization URL and explains both.
  Organization scans include only public repositories, including forks and archived repositories,
  even with a token. The server keeps its token on the server; the portable page keeps browser
  tokens only in the current tab. API authentication and unauthenticated public document reads
  retain their existing routing; no token appears in storage, URLs, HTML, or error messages.
- Show progress and disable submission while scanning; also ignore programmatic duplicate
  submissions. Clear the previous summary, skill list, document, test data, warnings, and
  visible results when starting another scan. Organization scans have no overall five-second target.
- Show the organization name, total skill count, and public repository counts: discovered,
  successfully scanned, failed, skipped. Group skills by repository alphabetically, then by
  the existing agent/elsewhere groups with name ordering within groups. Show copies and descriptions.
- Attribute every skill to its source repository in the list and document view. Select the
  first displayed skill initially, retain selection/full-document behavior across repositories,
  and pin each link to its own repository's scanned commit. Keep test-data links in a separate
  section, grouped by repository; never read them or count them as skills.
- Repository failures and empty repositories retain completed results with repository-specific
  warnings and a prominent partial-results status. Incomplete tree/file discovery also labels
  partial results. Rate-limit warnings use the same environment-specific guidance as scan
  errors, including waiting or entering a token in the portable page, never environment-variable
  advice to browser users. No skills from completed scans with failures is a partial empty state.
- Organization discovery errors (including user accounts, nonexistent organizations, failures
  on later pages, and rate limits) show the focused error panel and retry behavior. Explain
  explicitly that user accounts cannot be scanned as organizations. They are never shown as
  empty successful organizations.
- Organizations with no public repositories or complete scans with no skills show successful,
  distinct empty messages and repository counts. Regenerate the portable HTML after changes.
