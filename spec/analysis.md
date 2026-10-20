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
- Malformed front matter → a *warning*, the scan goes on
- Unreachable repository → a clear message, exit code 1
- Without a token, a tree too large for one GitHub answer: the files GitHub does list, plus
  `.agents/skills`, `.claude/skills`, `.github/skills` and `agent/skills` at the root in full,
  and a *warning* that skills may be missed
