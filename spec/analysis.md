# Repository analysis
## Input
A **GitHub repository** URL, or a local directory
## Output
Every `SKILL.md` that is a skill: **name**, **description**, **link**, and whether it is in an
*agent folder*. Apart: the links of the *test data*
## Terms
- **Skill directory**: the folder that holds a `SKILL.md`
- **Agent folder**: `<dir>/skills/` or `<dir>/skill/`, at any depth, where `<dir>` starts with
  a dot (`.claude`, `.cursor`, any other) or is `agent`. A skill is in it when its skill
  directory is right inside it: `.claude/skills/x/SKILL.md`
- **Test folder**: a folder with one of the words `test`, `tests`, `testing`, `testdata`, `fixture`,
  `fixtures`, `e2e` in its name. Words are split at `-`, `_`, `.` and capitals, any case:
  `jvmTest`, `integration-tests`, `testData`, `__fixtures__`; not `latest`, `attestation`
- **Test data**: a `SKILL.md` with a test folder above its skill directory, even in an agent
  folder. The skill directory's own name does not count: `.claude/skills/write-tests` is a skill
## Architecture
Core: fetch → find → parse. CLI: a *thin client*.
Skill: id = `repo:path`, name, description, commit, copies, in an agent folder (yes / no)
## Details
- **GitHub API**, no clone; *under 5 s* for intellij-community
- Every file named exactly `SKILL.md` counts, in any folder. Not followed: symbolic links;
  in a local directory, `.git` and `node_modules`
- The name: front matter, else the skill directory's name (the repository's, at the root)
- Test data is *not read* (it may be broken on purpose) and *not counted* as skills
- About where a skill is, only one thing is told: in an agent folder or not. Nothing else is
  guessed from folder names, such as whether a skill is for users
- **Copies**: skill directories with the same name, in agent folders inside the same folder
  (`.agents/skills/x`, `.claude/skills/x`), are *one skill*. Listed: the one in `.agents`,
  else the first by path; the others are its copies. Only the agent folder directly
  above `skills/` or `skill/` determines this preference; an ancestor named `.agents` does not
- The link pins the *scanned commit*
- Malformed front matter → a *warning*, the scan goes on. YAML-to-JavaScript conversion
  failures (including alias expansion limits) use the directory name, empty metadata,
  and preserve the original instructions. Keep YAML expansion limits enabled; a bad
  document must not discard other skills or completed organization repositories.
- Unreachable repository → a clear message, exit code 1
- Filter completed scan results by skill name and full description, case-insensitively.
  Trim the query and split on whitespace; every term must be a literal substring of either
  field, and terms may match different fields. Punctuation has no regex meaning. An empty
  query shows all skills; a missing description is empty. Never search document contents,
  paths, copies, or test data. Preserve order, classification, deduplication, pinned links,
  test-data links, and scan warnings; filtering does not change which files are scanned.
- Without a token, a tree too large for one GitHub answer: the files GitHub does list, plus
  `.agents/skills`, `.claude/skills`, `.github/skills` and `agent/skills` at the root in full,
  and a *warning* that skills may be missed

## Organization analysis
- A GitHub organization URL (`https://github.com/<organization>`, also accepting the
  existing optional scheme and trailing slash) scans every public repository's default
  branch. Repository URLs and local directory inputs retain their existing behavior.
- Validate the account type before enumeration. A user account produces an error explaining
  that organization scanning requires an organization. Invalid inputs, missing organizations,
  and discovery failures are errors, never successful empty scans.
- Enumerate the GitHub organization repositories API with `type=public`, 100 per page,
  following pagination. Include forks and archived repositories. Filter out private
  repositories even with a token, and deduplicate repeated repository entries across pages.
- Use GitHub API tree discovery with the existing token handling (no cloning or code-search
  indexing dependency). Scan repositories sequentially; file reads within each repository
  retain existing concurrency. The single-repository time target does not apply to an organization.
- Apply skill parsing, ordering, copies, test-data exclusion, and commit-pinned links independently
  per repository. Identical names or documents across repositories remain distinct skills.
- Return the organization name, alphabetically ordered repository results (case insensitive),
  total skills, and repository counts: discovered public repositories, successfully scanned,
  failed, skipped. Empty repositories (no default branch or an empty commit response) are
  skipped with a repository-specific warning. Each discovered repository belongs to one count.
- A failed repository does not discard completed repositories. Warnings identify their source
  repository. Failed/skipped repositories, truncated listings, and missing listed files make
  the organization result explicitly partial. Malformed front matter retains the existing
  warning and fallback behavior without marking the repository failed.
- Rate limits during discovery fail the scan. During a repository scan they mark that
  repository failed and retain completed results, with rate-limit guidance. Discovery must
  finish before repository scans start; a failed later discovery page is still an error.
- A GitHub response interrupted after its headers (an API answer or a document body) is a
  GitHub error like an unreachable request: during discovery it fails the scan; during a
  repository scan it marks that repository failed and retains completed results.
- No public repositories, or public repositories successfully scanned with no skills, are
  successful explicit empty states. A scan with failures and no skills is labeled partial.
