# Repository analysis
## Input
A **GitHub repository** URL, or a local directory
## Output
Every `SKILL.md`: **name**, **description**, **link**, and whether it is in an *agent folder*
## Terms
- **Skill directory**: the folder that holds a `SKILL.md`
- **Agent folder**: `<dir>/skills/` or `<dir>/skill/`, at any depth, where `<dir>` starts with
  a dot (`.claude`, `.cursor`, any other) or is `agent`. A skill is in it when its skill
  directory is right inside it: `.claude/skills/x/SKILL.md`
## Architecture
Core: fetch → find → parse. CLI: a *thin client*.
Skill: id = `repo:path`, name, description, commit, copies, in an agent folder (yes / no)
## Details
- **GitHub API**, no clone; *under 5 s* for intellij-community
- Every file named exactly `SKILL.md` counts, in any folder. Not followed: symbolic links;
  in a local directory, `.git` and `node_modules`
- The name: front matter, else the skill directory's name (the repository's, at the root)
- About where a skill is, only one thing is told: in an agent folder or not. Nothing is
  guessed from folder names, such as whether a skill is for users or for tests
- **Copies**: skill directories with the same name, in agent folders inside the same folder
  (`.agents/skills/x`, `.claude/skills/x`), are *one skill*. Listed: the one in `.agents`,
  else the first by path; the others are its copies
- The link pins the *scanned commit*
- Malformed front matter → a *warning*, the scan goes on
- Unreachable repository → a clear message, exit code 1
- Without a token, a tree too large for one GitHub answer: the files GitHub does list, plus
  `.agents/skills`, `.claude/skills`, `.github/skills` and `agent/skills` at the root in full,
  and a *warning* that skills may be missed
