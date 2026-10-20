# Repository analysis
## Input
A **GitHub repository** URL, or a local directory
## Output
Every `SKILL.md`: **name**, **description**, **link**
## Architecture
Core: fetch → find → parse. CLI: a *thin client*.
Skill: id = `repo:path`, name, description, commit
## Details
- **GitHub API**, no clone; *under 5 s* for intellij-community
- The name: front matter, else the directory
- The same skill in *any* agents' folders side by side (`.claude/skills/x`, `.cursor/skills/x`…)
  is *one skill*: the `.agents` file, else the first by path; the rest are its copies
- The link pins the *scanned commit*
- Malformed front matter → a *warning*, the scan goes on
- Unreachable repository → a clear message, exit code 1
