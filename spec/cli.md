# Command line
`./skill-atlas scan <GitHub URL | directory>`
Optional: `./skill-atlas scan <GitHub URL | directory> --filter "code review"`.
Match name and full description using the word-filter rules in [analysis.md](analysis.md).
Repository and group counts reflect matching skills; test-data links and warnings stay
unchanged. With a nonempty filter and no matches, print `No skills match your filter`.
Empty and whitespace-only filters behave like an unfiltered scan. A missing filter value,
unknown option, or extra argument gives usage and exit code 1 before scanning.
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
