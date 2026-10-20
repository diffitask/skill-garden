# Skill Atlas

Every agent skill in a repository: `./skill-atlas scan` finds each `SKILL.md` and prints its name,
description and link.

```console
$ npm ci
$ ./skill-atlas scan https://github.com/JetBrains/kotlin
JetBrains/kotlin · 6 skills
In agents' folders · 6 skills
…
build-tools-bump-gradle-api — Bumps the Gradle API version that Kotlin Gradle plugins are compiled against in the Kotlin compiler repository.
  https://github.com/JetBrains/kotlin/blob/5ab6270ab772d113e8ad52ebfcaa0109c522ae00/.claude/skills/build-tools-bump-gradle-api/SKILL.md
…
```

Set `GITHUB_TOKEN` for a higher GitHub rate limit. `npm test` runs the tests.

- [spec/](spec/): what it does. [AGENTS.md](AGENTS.md): the definition of done.
- [fixture/](fixture/README.md): a small repository for the tests.

## Web view on localhost

```sh
npm ci
npm start
# Alternatively: ./skill-atlas web
```

Open [localhost:3000](http://localhost:3000). Keep the server running and reuse
this address whenever you want to browse skills; there is no HTML file to download.
Enter a GitHub repository URL, then select a skill to read its full SKILL.md.
Press Ctrl+C in the terminal to stop the server.

Set `PORT` to change the port (for example, `PORT=3001 npm start`), and optionally
`GITHUB_TOKEN` for private repositories or higher API limits. The token stays on
the server. If the port is already in use, stop the other server or choose another port.

The portable HTML export remains available as an optional alternative through
`npm run build:web`. Regenerate it after changing the UI or scanner.
