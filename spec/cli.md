# Command line
`./skill-atlas scan <GitHub URL | directory>`
Prints the result **at once**; *nothing is stored*.
`GITHUB_TOKEN`, optional: a higher GitHub rate limit.
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
