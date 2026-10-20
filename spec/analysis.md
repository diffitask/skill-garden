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
- A `SKILL.md` *anywhere* counts, not only in the agents' folders
- A repository too large for GitHub to list at once, without a token: skills from the part
  GitHub does list, plus the agents' folders in full, and a *warning* that some may be missed
- The name: front matter, else the directory
- The same skill in *any* agents' folders side by side (`.claude/skills/x`, `.cursor/skills/x`…)
  is *one skill*: the `.agents` file, else the first by path; the rest are its copies
- The link pins the *scanned commit*
- Malformed front matter → a *warning*, the scan goes on
- Unreachable repository → a clear message, exit code 1
