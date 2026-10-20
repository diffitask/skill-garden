// Publishes a recorded demo (see record.mjs) as a new PR comment, with images and
// videos uploaded through `gh pr comment --attach`. See spec/pr-demo.md.
import { execFile } from 'node:child_process';
import { access, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

export const LABEL = 'AI: ready to merge';
const MAX_ATTACHMENTS = 50; // gh's limit per command
const marker = (head) => `<!-- air-pr-demo:${head} -->`;
const short = (sha) => sha.slice(0, 7);
/** Error text comes from PR code: one line, no markup. */
const quote = (text) => `\`${String(text).replace(/[`\s]+/g, ' ').trim().slice(0, 200)}\``;

function validate(env) {
  if (!/^[a-zA-Z0-9][\w.-]*\/[a-zA-Z0-9][\w.-]*$/.test(env.DEMO_REPOSITORY ?? '')) throw new Error('Set DEMO_REPOSITORY to owner/repo');
  const number = Number(env.PR_NUMBER);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error('Invalid PR number');
  for (const name of ['PR_HEAD_SHA', 'PR_BASE_SHA']) if (!/^[a-f0-9]{40}$/.test(env[name] ?? '')) throw new Error(`Invalid ${name}`);
  if (env.DEMO_RUN_URL && new URL(env.DEMO_RUN_URL).protocol !== 'https:') throw new Error('Invalid run URL');
  return { repository: env.DEMO_REPOSITORY, number, head: env.PR_HEAD_SHA, base: env.PR_BASE_SHA, runUrl: env.DEMO_RUN_URL, force: env.DEMO_FORCE === '1' };
}

const exists = (path) => access(path).then(() => true, () => false);

/** The comment, and the files it references, relative to the output directory. */
export async function composeComment(manifest, out, { head, base, runUrl }) {
  const attachments = [];
  const shown = manifest.moments.filter((m) => m.status !== 'unchanged');
  const unchanged = manifest.moments.filter((m) => m.status === 'unchanged');
  const videos = ['before', 'after'].filter((label) => manifest[label].video);
  const pictured = shown.filter((m) => m.image).slice(0, MAX_ATTACHMENTS - videos.length);
  for (const moment of pictured) if (!(await exists(join(out, moment.image)))) throw new Error(`Missing image: ${moment.image}`);
  const hint = (m) => m.note ?? m.beforeNote;
  const lines = [marker(head), `## PR demo${manifest.title ? `: ${manifest.title}` : ''}`, '',
    `The same steps before this PR (\`${short(base)}\`) and with it (\`${short(head)}\`). Each picture outlines one change in red.`];
  lines.push('', '**What to look at**', '');
  if (!shown.length) lines.push('No visible changes in the recorded moments.');
  for (const m of shown) {
    const kind = m.status === 'new' ? 'new' : m.status === 'unavailable' ? 'could not compare' : 'changed';
    lines.push(`${m.number}. **${m.name}** (${kind})${hint(m) ? `: ${hint(m)}` : ''}`);
  }
  if (unchanged.length) lines.push('', `Same as before: ${unchanged.map((m) => m.name).join(', ')}.`);
  for (const m of shown) {
    lines.push('', `### ${m.number}. ${m.name}`);
    if (hint(m)) lines.push('', `> ${hint(m)}`);
    if (m.status === 'unavailable') {
      const reasons = ['before', 'after'].filter((label) => m.errors[label]).map((label) => `${label}: ${quote(m.errors[label])}`);
      lines.push('', `Could not compare: ${reasons.join('; ') || 'no screenshot in either version'}.`);
    }
    if (pictured.includes(m)) {
      lines.push('', `![${m.name}: before and with this PR, the change outlined in red](./${m.image})`);
      attachments.push(`./${m.image}`);
    } else if (m.image) lines.push('', 'Image omitted: GitHub allows 50 attachments per comment.');
    const notes = [];
    if (m.autoFocus) notes.push('outlined automatically where the screens differ');
    if (m.otherChanges) notes.push(`${m.otherChanges} more ${m.otherChanges === 1 ? 'area differs' : 'areas differ'} on this screen, see the video`);
    if (notes.length) lines.push('', `_${notes.join('; ')}._`);
  }
  lines.push('', '### Videos', '', 'Captions point out what to watch; the cursor shows every click.');
  for (const [label, sha] of [['before', base], ['after', head]]) {
    lines.push('', `**${label === 'before' ? 'Before this PR' : 'With this PR'}** (\`${short(sha)}\`)`, '');
    const video = manifest[label].video;
    if (video && (await exists(join(out, video)))) {
      lines.push(`![](./${video})`);
      attachments.push(`./${video}`);
    } else lines.push(`No video: ${quote(manifest[label].error ?? 'the recording is missing')}`);
  }
  if (runUrl) lines.push('', `[Automation run](${runUrl})`);
  return { body: `${lines.join('\n')}\n`, attachments };
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {string} out directory written by record.mjs
 * @param {(args: string[], options?: {cwd?: string}) => Promise<string>} gh runs GitHub CLI, returns stdout
 */
export async function publishDemo(env, out, gh) {
  const target = validate(env);
  out = resolve(out);
  const manifest = JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8'));
  const pr = JSON.parse(await gh(['api', `repos/${target.repository}/pulls/${target.number}`]));
  if (pr.state !== 'open') return { skipped: 'closed' };
  if (pr.head.sha !== target.head) return { skipped: 'head_changed' };
  if (!pr.labels.some((label) => label.name === LABEL)) return { skipped: 'label_missing' };
  if (!target.force) {
    const pages = JSON.parse(await gh(['api', '--paginate', '--slurp', `repos/${target.repository}/issues/${target.number}/comments?per_page=100`]));
    if (pages.flat().some((comment) => comment.body?.includes(marker(target.head)))) return { skipped: 'already_published' };
  }
  const { body, attachments } = await composeComment(manifest, out, target);
  await writeFile(join(out, 'comment.md'), body);
  const args = ['pr', 'comment', String(target.number), '-R', target.repository, '--body-file', './comment.md'];
  for (const file of attachments) args.push('--attach', file);
  const url = (await gh(args, { cwd: out })).trim().split('\n').at(-1);
  return { url, attachments: attachments.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw new Error('Usage: publish.mjs <out-dir>');
  const exec = promisify(execFile);
  const result = await publishDemo(process.env, process.argv[2], async (args, options) =>
    (await exec('gh', args, { cwd: options?.cwd, maxBuffer: 16 * 1024 * 1024 })).stdout);
  console.log(result.skipped ? `Demo not published: ${result.skipped}.` : `PR demo published: ${result.url}`);
}
