import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

function timestamp(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be an ISO 8601 timestamp with a timezone`);
  }
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const calendar = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() + 1 !== month || calendar.getUTCDate() !== day) {
    throw new Error(`${label} has an invalid calendar date`);
  }
  return new Date(value).toISOString();
}

export function configuration(env, now = new Date()) {
  const repository = env.STATUS_UPDATE_REPOSITORY || 'diffitask/ai-workshop-2026';
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Invalid repository');
  const since = timestamp(env.STATUS_UPDATE_SINCE, 'STATUS_UPDATE_SINCE');
  const until = timestamp(env.STATUS_UPDATE_UNTIL || now.toISOString(), 'STATUS_UPDATE_UNTIL');
  if (since >= until) throw new Error('Start must precede end');
  if (Date.parse(until) > now.getTime()) throw new Error('End must not be in the future');
  const channel = env.STATUS_UPDATE_CHANNEL;
  if (!/^[CG][A-Z0-9]+$/.test(channel || '')) throw new Error('STATUS_UPDATE_CHANNEL must be a Slack channel ID');
  return { repository, since, until, channel };
}

export function github(endpoint) {
  try {
    return JSON.parse(execFileSync('gh', ['api', endpoint], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 20 * 1024 * 1024, timeout: 60000 }));
  } catch {
    throw new Error('GitHub read failed; check gh authentication and repository access');
  }
}

export async function collect(config, request) {
  const prs = [], issues = [], seen = new Set();
  const inWindow = value => {
    const time = timestamp(value, 'GitHub completion time');
    return time >= config.since && time < config.until;
  };
  for (let page = 1; ; page++) {
    const items = await request(`repos/${config.repository}/issues?state=closed&since=${encodeURIComponent(config.since)}&sort=created&direction=asc&per_page=100&page=${page}`);
    if (!Array.isArray(items)) throw new Error('Invalid GitHub issues response');
    for (const item of items) {
      if (!Number.isSafeInteger(item.number) || item.number < 1 || typeof item.title !== 'string') throw new Error('Invalid GitHub item');
      if (seen.has(item.number)) continue;
      seen.add(item.number);
      if (item.pull_request) {
        const pr = await request(`repos/${config.repository}/pulls/${item.number}`);
        if (!pr || !Object.hasOwn(pr, 'merged_at')) throw new Error('Invalid GitHub PR response');
        if (pr.merged_at && inWindow(pr.merged_at)) prs.push({ number: item.number, title: item.title, time: timestamp(pr.merged_at, 'merged_at') });
      } else if (item.state === 'closed' && item.state_reason === 'completed' && inWindow(item.closed_at)) {
        issues.push({ number: item.number, title: item.title, time: timestamp(item.closed_at, 'closed_at') });
      }
    }
    if (items.length < 100) break;
  }
  for (const group of [prs, issues]) group.sort((a, b) => a.time.localeCompare(b.time) || a.number - b.number);
  return { prs, issues };
}

function escape(value) {
  return value.replace(/[\r\n\t]+/g, ' ').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function render(config, { prs, issues }) {
  const section = (label, items, kind) => [`${label} (${items.length})`, ...(items.length ? items.map(item =>
    `• <https://github.com/${config.repository}/${kind}/${item.number}|#${item.number}> ${escape(item.title)}`) : ['• None'])].join('\n');
  const text = [`Team status update — ${config.repository}`, `[${config.since}, ${config.until}) UTC`,
    section('Merged PRs', prs, 'pull'), section('Resolved issues', issues, 'issues')].join('\n\n');
  if (text.length > 35000) throw new Error('Update exceeds single-message limit; use smaller explicit time windows');
  return text;
}

export async function deliver(config, text, token, fetcher = fetch) {
  if (!token) throw new Error('SLACK_BOT_TOKEN is required for delivery');
  async function slack(method, body) {
    let response;
    const read = method === 'conversations.info';
    try {
      response = await fetcher(`https://slack.com/api/${method}${read ? `?channel=${encodeURIComponent(body.channel)}` : ''}`, {
        method: read ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
        ...(read ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000), redirect: 'error',
      });
    } catch {
      throw new Error(`Slack ${method} transport failed; inspect delivery before retrying`);
    }
    let data;
    try { data = await response.json(); } catch { throw new Error(`Slack ${method} returned invalid JSON; inspect delivery before retrying`); }
    if (!response.ok || data?.ok !== true) throw new Error(`Slack ${method} failed; inspect access and delivery before retrying`);
    return data;
  }
  const info = await slack('conversations.info', { channel: config.channel });
  if (info.channel?.id !== config.channel || info.channel.is_private !== true || info.channel.is_member !== true || info.channel.is_archived !== false) {
    throw new Error('Destination must be an active private channel with the bot as a member');
  }
  const result = await slack('chat.postMessage', { channel: config.channel, text,
    mrkdwn: true, parse: 'none', link_names: false, unfurl_links: false, unfurl_media: false });
  if (result.channel !== config.channel || typeof result.ts !== 'string' || !/^\d+\.\d+$/.test(result.ts)) {
    throw new Error('Slack delivery was not confirmed; inspect channel before retrying');
  }
  return { channel: result.channel, ts: result.ts, until: config.until };
}

export async function run({ env = process.env, dryRun = false, request = github, fetcher = fetch, now = new Date() } = {}) {
  const config = configuration(env, now);
  if (!dryRun && !env.SLACK_BOT_TOKEN) throw new Error('SLACK_BOT_TOKEN is required for delivery');
  const report = render(config, await collect(config, request));
  return dryRun ? { preview: report, since: config.since, until: config.until } : deliver(config, report, env.SLACK_BOT_TOKEN, fetcher);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.slice(2).some(arg => arg !== '--dry-run')) throw new Error('Only --dry-run is supported');
    console.log(JSON.stringify(await run({ dryRun: process.argv.includes('--dry-run') }), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
