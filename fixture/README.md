# fixture

A small repository for the tests.

| Path | Case |
| --- | --- |
| `.agents/skills/commits` | a skill |
| `.claude/skills/commits` | its copy in another agent's folder |
| `.github/skills/code-style` | a skill in another agent's folder |
| `.agents/skills/release-checklist` | malformed front matter |
| `docs/workflows/triage` | the repository's own workflow, outside the agents' folders |
| `plugins/mcp-tools/resources/assistant/skills/aspect-generator` | part of the product, shipped inside a plugin |
| `tests/data/.claude/skills/sample` | test data, though in an agent's folder |
| `integration-tests/src/jvmTest/resources/skills/weather-retrieval` | test data; no front matter, so a warning if it were read |
| `.claude/skills/write-tests` | a skill about tests, not test data |
