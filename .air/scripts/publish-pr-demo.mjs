import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { githubRequest } from './feedback-state.mjs';

function target(env) {
  if (!/^[a-zA-Z0-9][\w.-]*\/[a-zA-Z0-9][\w.-]*$/.test(env.DEMO_REPOSITORY ?? '')) {
    throw new Error('Set DEMO_REPOSITORY to owner/repo');
  }
  if (!/^[1-9]\d*$/.test(env.PR_NUMBER ?? '') || !Number.isSafeInteger(Number(env.PR_NUMBER))) throw new Error('Invalid PR number');
  for (const key of ['PR_HEAD_SHA', 'PR_BASE_SHA']) {
    if (!/^[a-f0-9]{40}$/.test(env[key] ?? '')) throw new Error(`Invalid ${key}`);
  }
  if (env.DEMO_REVISION !== undefined &&
      (!/^[1-9]\d*$/.test(env.DEMO_REVISION) || !Number.isSafeInteger(Number(env.DEMO_REVISION)) || Number(env.DEMO_REVISION) < 2)) {
    throw new Error('Invalid DEMO_REVISION: use an explicit presentation revision >=2');
  }
  const prefix = `<!-- pr-demo:v1:${env.PR_HEAD_SHA}`;
  return {
    root: `repos/${env.DEMO_REPOSITORY}`, number: Number(env.PR_NUMBER),
    marker: `${prefix}${env.DEMO_REVISION ? `:r${env.DEMO_REVISION}` : ''} -->`,
    headMarker: new RegExp(`^${prefix}(?::r[1-9][0-9]*)? -->\\n`),
  };
}

function eligible(pr, env) {
  if (pr.state !== 'open' || pr.draft || pr.head?.sha !== env.PR_HEAD_SHA || pr.base?.sha !== env.PR_BASE_SHA) return false;
  if (pr.head.repo?.full_name !== env.DEMO_REPOSITORY || pr.base.repo?.full_name !== env.DEMO_REPOSITORY) return false;
  return pr.labels?.some((label) => label.name === 'AI: review passed') === true;
}

// Sequential deduplication, not a lock: callers must serialize overlapping runs.
export async function inspectDemo(env, request) {
  const { root, number, marker, headMarker } = target(env);
  const path = `${root}/pulls/${number}`;
  if (!eligible(await request('GET', path), env)) return { skipped: true, reason: 'PR is no longer eligible' };
  for (let page = 1; ; page++) {
    const comments = await request('GET', `${root}/issues/${number}/comments?per_page=100&page=${page}`);
    if (!Array.isArray(comments)) throw new Error('Invalid GitHub comments response');
    const existing = comments.find((comment) => typeof comment.body === 'string' &&
      (env.DEMO_REVISION ? comment.body.startsWith(`${marker}\n`) : headMarker.test(comment.body)));
    if (existing) return { skipped: true, reason: 'Demo already published for this head', html_url: existing.html_url };
    if (comments.length < 100) break;
  }
  // Slow/paginated reads must not authorize publication for a superseded revision.
  if (!eligible(await request('GET', path), env)) return { skipped: true, reason: 'PR changed during inspection' };
  return { skipped: false };
}

function httpsUrl(value, name) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`Invalid ${name}`); }
  if (url.protocol !== 'https:' || url.username || url.password || /[\s<>]/.test(value)) throw new Error(`Invalid ${name}`);
  return url.href;
}

export async function publishDemo(env, request) {
  const { root, number, marker } = target(env);
  const video = httpsUrl(env.DEMO_VIDEO_URL, 'DEMO_VIDEO_URL');
  const preview = env.DEMO_PREVIEW_URL ? httpsUrl(env.DEMO_PREVIEW_URL, 'DEMO_PREVIEW_URL') : undefined;
  if (!env.DEMO_MESSAGE?.trim()) throw new Error('Demo report must not be empty');
  const body = `${marker}\n## Changes in action\n\n${env.DEMO_MESSAGE.trim()}\n\n${preview ? `![Demo preview](<${preview}>)\n\n` : ''}[Watch the demo video](<${video}>)\n\nBase: ${env.PR_BASE_SHA}\nHead: ${env.PR_HEAD_SHA}`;
  if (body.length > 60000) throw new Error('Demo report is too large');
  const inspection = await inspectDemo(env, request);
  if (inspection.skipped) return inspection;
  const comment = await request('POST', `${root}/issues/${number}/comments`, { body });
  // Do not retry an uncertain write or a failed readback. Preserve its URL in the error.
  try {
    if (!Number.isSafeInteger(comment.id) || !comment.html_url) throw new Error('Incomplete comment response');
    const saved = await request('GET', `${root}/issues/comments/${comment.id}`);
    if (saved.body !== body || saved.issue_url !== `https://api.github.com/${root}/issues/${number}`) throw new Error('Comment readback mismatch');
  } catch (error) {
    throw new Error(`Demo comment may be published at ${comment.html_url ?? 'an unknown URL'}; inspect before retrying: ${error.message}`);
  }
  return { skipped: false, html_url: comment.html_url };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , command, file] = process.argv;
  let result;
  if (command === 'check') result = await inspectDemo(process.env, githubRequest);
  else if (command === 'publish' && file) result = await publishDemo({ ...process.env, DEMO_MESSAGE: await readFile(file, 'utf8') }, githubRequest);
  else throw new Error('Usage: publish-pr-demo.mjs check | publish <comment-file>');
  console.log(JSON.stringify(result));
}
