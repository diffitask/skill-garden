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

To browse skills locally, run `npm start` and open http://127.0.0.1:3000.
Enter a GitHub repository URL, then select a skill to read its full SKILL.md.
Set `PORT` to change the port, and optionally `GITHUB_TOKEN` for private repositories or higher API limits.

For a version that needs no server or port setup, open **skill-atlas.html** directly
in your browser. It browses public repositories and needs an internet connection.
Regenerate the file with `npm run build:web` after changing the UI or scanner.

If GitHub reports a request limit in the portable page, paste a personal access token
into the **GitHub token (optional)** field below the repository URL, then click **Try again**. The token is sent only to
GitHub and kept in the current tab; it is never saved. You can also wait for
GitHub's limit to reset and retry without a token.

Labeling a PR **AI: ready to merge** has Air record the web view before and after the PR
and comment with both videos and highlighted before/after screenshots: see
[spec/pr-demo.md](spec/pr-demo.md) and the [pr-demo skill](.agents/skills/pr-demo/SKILL.md).
