# Command line
`./skill-atlas scan <GitHub URL | directory>`
Prints the result **at once**; *nothing is stored*.
`GITHUB_TOKEN`, optional: a higher GitHub rate limit.
## Version
`./skill-atlas --version` prints the version from the installed `package.json`, followed
by a newline, and exits with code 0. It works from any working directory without
scanning a repository, making network requests, or writing files. Scan behavior is unchanged.
## Output
```
JetBrains/kotlin · 6 skills
In agents' folders · 6 skills
build-tools-bump-gradle-api — Bumps the Gradle API…
  https://github.com/JetBrains/kotlin/blob/<commit>/…
```
- Two groups, each under `<group> · N skills`: `In agents' folders` (see *agent folder* in
  [analysis.md](analysis.md)), then `Elsewhere`. An empty group is not printed
- Last, `Test data, not skills · N files`: only the links
- Sorted by **name**; the description's *first sentence*
- `also in <paths>` for copies; warnings go to *stderr*

## Organizations
- `./skill-atlas scan https://github.com/<organization>` prints the organization name,
  total skill count, and public repository counts (discovered, successfully scanned,
  failed, skipped). It uses the same optional `GITHUB_TOKEN` and stores nothing.
- Print repositories in alphabetical order, with the existing skill groups, name ordering,
  descriptions, copies, commit-pinned links, and separate test-data links within each.
- Print an explicit `No public repositories found.` or `No skills found.` on successful
  empty scans. For incomplete scans, label `PARTIAL RESULTS`, retain completed repository
  output, report repository-specific warnings to stderr, and return exit code 1.
- Invalid/user/nonexistent organization targets and organization discovery failures return
  exit code 1 with a clear error. Anonymous rate-limit errors recommend `GITHUB_TOKEN`;
  authenticated limits recommend waiting. A successful complete scan returns exit code 0.
