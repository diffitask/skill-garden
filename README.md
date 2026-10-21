<div align="center">

# 🌸 Skill Garden

### Skills are like flowers. They bloom everywhere.

Discover agent skills on GitHub. Find inspiration. Reuse what works.

**[Get the HTML app](skill-garden.html)** · **[Try it locally](#try-it-locally)** · **[GitHub](https://github.com/diffitask/skill-garden)**

No watering required.

</div>

![Skill Garden: a botanical interface for discovering agent skills on GitHub](docs/screenshots/welcome.png)

## Pick a repository. See what grows.

Explore the `SKILL.md` files inside a GitHub repository or an organization's public repositories. Each skill gets its own flower, so familiar discoveries are easy to recognize.

- **Discover** skills and search their names and descriptions.
- **Find connections** with shared-word clusters or optional AI grouping by meaning.
- **Read clearly** with a skill summary and a formatted full document.
- **Make it yours** by copying the original Markdown, including its metadata.

![Related skills grouped into separate Without AI and With AI panels](docs/screenshots/clusters.png)

## Your next idea might already be blooming.

Open one skill, see what it does, and explore its full instructions. Copy the original `SKILL.md` when you find something useful.

![An IntelliJ skill and its full SKILL.md shown as a readable document](docs/screenshots/skill-document.png)

## Try it — one HTML file

1. Open **[skill-garden.html](skill-garden.html)** in this repository and choose **Download raw file**.
2. Open the downloaded file in your browser.
3. Enter a GitHub repository or organization URL and choose **Explore skills**.

Try [`JetBrains/intellij-community`](https://github.com/JetBrains/intellij-community) to explore the skills shown above.

The HTML app is self-contained: no installation or local server is needed. An internet connection is required to scan public GitHub sources. If GitHub limits your requests, wait and retry, or enter an optional GitHub token. Browser tokens are sent only to GitHub and kept in the current tab; they are never saved.

## Try it locally

Requires **Node.js 24 or later**.

```bash
npm ci
npm start
```

Open [127.0.0.1:3000](http://127.0.0.1:3000). Set `PORT` to use another port. The local server can also scan private repositories with `GITHUB_TOKEN`.

### Optional: group skills with AI

Install Claude Code and log in, then run `npm start` and choose **Cluster with AI**. The helper uses Claude Haiku 4.5 and sends skill names and descriptions to Claude.

To use AI from the downloaded HTML app, open **Connect your local AI helper** and paste the pairing code printed by `npm start`. Keep the server running. Set `CLAUDE_BIN` if the CLI is outside your `PATH`.

<details>
<summary><strong>CLI, development, and tests</strong></summary>

The command-line entry point is `skill-atlas`:

```bash
./skill-atlas scan https://github.com/JetBrains/intellij-community
./skill-atlas scan https://github.com/JetBrains
```

It prints skill names, descriptions, and commit-pinned GitHub links. Set `GITHUB_TOKEN` for private repository access or higher API limits. Organization scans include public repositories only, including forks and archived repositories. User account URLs are not organization URLs.

Large repositories can return partial results when GitHub truncates a tree; warnings explain the scope. Failed repository scans preserve completed organization results. Incomplete CLI scans exit with status 1.

Rebuild the portable HTML after changing the UI or scanner:

```bash
npm run build:web
```

Run the checks:

```bash
npm test
npx playwright install --with-deps chromium
npm run test:browser
npm run typecheck
```

Browser integration tests exercise both the server and portable HTML with replayed GitHub responses.

[Specs](spec/) · [Development instructions](AGENTS.md) · [Test fixture](fixture/README.md)

</details>

---

<div align="center">

**Explore new skills. Grow your own garden.**

[github.com/diffitask/skill-garden](https://github.com/diffitask/skill-garden)

</div>
