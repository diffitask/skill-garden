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
  const timezone = env.STATUS_UPDATE_TIMEZONE || 'Europe/Moscow';
  try { new Intl.DateTimeFormat('ru-RU', { timeZone: timezone }); } catch { throw new Error('Invalid STATUS_UPDATE_TIMEZONE'); }
  const messageTs = env.STATUS_UPDATE_MESSAGE_TS;
  if (messageTs !== undefined && !/^\d+\.\d+$/.test(messageTs)) throw new Error('Invalid STATUS_UPDATE_MESSAGE_TS');
  return { repository, since, until, channel, timezone, ...(messageTs ? { messageTs } : {}) };
}

export function github(endpoint) {
  try {
    return JSON.parse(execFileSync('gh', ['api', endpoint], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 20 * 1024 * 1024, timeout: 60000 }));
  } catch {
    throw new Error('GitHub read failed; check gh authentication and repository access');
  }
}

async function pages(request, endpoint, select = data => data) {
  const result = [];
  for (let page = 1; ; page++) {
    const data = await request(`${endpoint}${endpoint.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    const items = select(data);
    if (!Array.isArray(items)) throw new Error('Invalid paginated GitHub response');
    result.push(...items);
    if (items.length < 100) return result;
  }
}

function login(user) {
  if (user === null) return null;
  if (!user || typeof user.login !== 'string' || !/^[\w-]+(?:\[bot\])?$/.test(user.login)) throw new Error('Invalid GitHub user');
  return user.login;
}

function decisions(reviews, cutoff) {
  const latest = new Map();
  for (const review of [...reviews].sort((a, b) => a.time.localeCompare(b.time) || a.id - b.id)) {
    if (review.time <= cutoff && review.user && ['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(review.state)) latest.set(review.user, review);
  }
  return [...latest.values()];
}

export function prStatus(pr) {
  if (pr.draft) return { key: 'draft', label: '🛠 Черновик' };
  const effective = decisions(pr.reviews, '9999');
  if (effective.some(r => r.state === 'CHANGES_REQUESTED')) return { key: 'changes', label: '🔧 Нужны правки' };
  if (pr.requested.length || pr.teams.length) return { key: 'waiting', label: '👀 Ждёт ревью' };
  const approvals = effective.filter(r => r.state === 'APPROVED');
  if (approvals.some(r => r.commit === pr.head)) return { key: 'approved', label: '👍 Есть одобрение' };
  if (approvals.length) return { key: 'stale', label: '🔄 Изменён после одобрения' };
  if (pr.reviews.some(r => r.state === 'COMMENTED')) return { key: 'discussion', label: '💬 Обсуждение, одобрения нет' };
  return { key: 'open', label: '✍️ Открыт, ревью не назначено' };
}

export async function collect(config, request) {
  const prs = [], open = [], issues = [], seen = new Set();
  const root = `repos/${config.repository}`;
  const inWindow = value => {
    const time = timestamp(value, 'GitHub completion time');
    return time >= config.since && time < config.until;
  };
  async function readPr(number) {
    const pr = await request(`${root}/pulls/${number}`);
    if (!pr || pr.number !== number || typeof pr.title !== 'string' || !['open', 'closed'].includes(pr.state) ||
      typeof pr.draft !== 'boolean' || typeof pr.head?.sha !== 'string' || !Object.hasOwn(pr, 'merged_at')) throw new Error('Invalid GitHub PR response');
    const merged = pr.merged_at && inWindow(pr.merged_at);
    if (pr.state !== 'open' && !merged) return;
    const rawReviews = await pages(request, `${root}/pulls/${number}/reviews`);
    const reviews = rawReviews.filter(r => r.state !== 'PENDING').map(r => {
      if (!Number.isSafeInteger(r.id) || !['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED'].includes(r.state) || typeof r.commit_id !== 'string') throw new Error('Invalid GitHub review');
      return { id: r.id, user: login(r.user), state: r.state, commit: r.commit_id, time: timestamp(r.submitted_at, 'submitted_at') };
    });
    const value = { number, title: pr.title, author: login(pr.user), draft: pr.draft, head: pr.head.sha, reviews, requested: [], teams: [] };
    if (merged) {
      prs.push({ ...value, time: timestamp(pr.merged_at, 'merged_at'), mergedBy: login(pr.merged_by) });
    } else {
      // This endpoint returns all users/teams and has no pagination parameters.
      const requests = await request(`${root}/pulls/${number}/requested_reviewers`);
      if (!Array.isArray(requests?.users) || !Array.isArray(requests?.teams)) throw new Error('Invalid requested reviewers');
      value.requested.push(...requests.users.map(login).filter(Boolean));
      for (const team of requests.teams) {
        if (typeof team.slug !== 'string') throw new Error('Invalid requested team');
        value.teams.push(team.slug);
      }
      value.requested = [...new Set(value.requested)].sort();
      value.teams = [...new Set(value.teams)].sort();
      open.push({ ...value, status: prStatus(value) });
    }
  }
  const items = await pages(request, `${root}/issues?state=closed&since=${encodeURIComponent(config.since)}&sort=created&direction=asc`);
  for (const item of items) {
      if (!Number.isSafeInteger(item.number) || item.number < 1 || typeof item.title !== 'string') throw new Error('Invalid GitHub item');
      if (seen.has(item.number)) continue;
      seen.add(item.number);
      if (item.pull_request) {
        await readPr(item.number);
      } else if (item.state === 'closed' && item.state_reason === 'completed' && inWindow(item.closed_at)) {
        if (!Array.isArray(item.assignees)) throw new Error('Invalid issue assignees');
        issues.push({ number: item.number, title: item.title, time: timestamp(item.closed_at, 'closed_at'), assignees: item.assignees.map(login).filter(Boolean) });
      }
  }
  for (const item of await pages(request, `${root}/pulls?state=open&sort=created&direction=asc`)) {
    if (!Number.isSafeInteger(item.number) || item.number < 1) throw new Error('Invalid open PR');
    if (!seen.has(item.number)) { seen.add(item.number); await readPr(item.number); }
  }
  const reviewActivity = [];
  for (const pr of [...open, ...prs]) for (const review of pr.reviews) {
    if (review.user && review.state !== 'DISMISSED' && inWindow(review.time)) reviewActivity.push({ ...review, number: pr.number, title: pr.title });
  }
  for (const group of [prs, issues]) group.sort((a, b) => a.time.localeCompare(b.time) || a.number - b.number);
  open.sort((a, b) => a.number - b.number);
  reviewActivity.sort((a, b) => a.time.localeCompare(b.time) || a.id - b.id);
  return { prs, open, issues, reviewActivity };
}

function escape(value) {
  return value.replace(/[\r\n\t]+/g, ' ').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function render(config, { prs, open, issues, reviewActivity }) {
  const people = new Map();
  const person = name => {
    if (!people.has(name)) people.set(name, { name, authored: [], waiting: [], reviewed: [], merged: [], completed: [] });
    return people.get(name);
  };
  const link = (item, kind = 'pull') => `<https://github.com/${config.repository}/${kind}/${item.number}|#${item.number}> ${escape(item.title)}`;
  const name = value => value ? escape(value) : 'пользователь удалён';
  for (const pr of open) {
    let detail = '';
    if (pr.status.key === 'waiting') detail = ` · ждём: ${[...pr.requested.map(name), ...pr.teams.map(t => `команда ${escape(t)}`)].join(', ')}`;
    if (pr.status.key === 'changes') detail = ` · от ${decisions(pr.reviews, '9999').filter(r => r.state === 'CHANGES_REQUESTED').map(r => name(r.user)).join(', ')}`;
    if (pr.status.key === 'approved') detail = ` · ${decisions(pr.reviews, '9999').filter(r => r.state === 'APPROVED' && r.commit === pr.head).map(r => name(r.user)).join(', ')}`;
    person(pr.author || 'Автор удалён').authored.push(`${pr.status.label} · ${link(pr)}${detail}`);
    if (!pr.draft) for (const reviewer of pr.requested) person(reviewer).waiting.push(`👀 ${link(pr)} · автор ${name(pr.author)}`);
  }
  for (const pr of prs) {
    const approved = decisions(pr.reviews, pr.time).filter(r => r.state === 'APPROVED').map(r => name(r.user));
    person(pr.author || 'Автор удалён').merged.push({ line: `✅ ${link(pr)}`,
      detail: `${approved.length ? `Одобрили: ${approved.join(', ')}` : 'Формального одобрения нет'} · влил ${name(pr.mergedBy)}` });
  }
  for (const review of reviewActivity) {
    const action = { APPROVED: '👍 Одобрил', CHANGES_REQUESTED: '🔧 Запросил правки', COMMENTED: '💬 Прокомментировал' }[review.state];
    person(review.user).reviewed.push(`${action} · ${link(review)}`);
  }
  for (const issue of issues) for (const assignee of new Set(issue.assignees.length ? issue.assignees : ['Без исполнителя'])) {
    person(assignee).completed.push(`☑️ ${link(issue, 'issues')}`);
  }
  const format = value => new Intl.DateTimeFormat('ru-RU', { timeZone: config.timezone, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));
  const period = `${format(config.since)} — ${format(config.until)} · ${config.timezone}`;
  const requestedCount = open.filter(pr => !pr.draft && (pr.requested.length || pr.teams.length)).length;
  const summary = `Открыто: ${open.length} · Ждут ревью: ${requestedCount} · Влито: ${prs.length} · Задач закрыто: ${issues.length}`;
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: 'Команда · GitHub', emoji: true } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: `<https://github.com/${config.repository}|${config.repository}> · ${period}` }] },
    { type: 'section', text: { type: 'mrkdwn', text: summary.replace(/(Открыто|Ждут ревью|Влито|Задач закрыто): (\d+)/g, '*$1:* $2') } },
    { type: 'context', elements: [{ type: 'plain_text', text: 'Открытые PR — текущий снимок. Влитые PR, ревью и закрытые задачи — за период. Одобрение ≠ готовность к слиянию.' }] },
  ];
  const textParts = [`Команда · ${config.repository}`, period, `[${config.since}, ${config.until})`, summary,
    'Открытые PR — текущий снимок; завершённое и ревью — за период.'];
  const ordered = [...people.values()].sort((a, b) => Number(Boolean(b.waiting.length || b.authored.length)) - Number(Boolean(a.waiting.length || a.authored.length)) || a.name.localeCompare(b.name));
  for (const p of ordered) {
    const heading = p.name.endsWith('[bot]') ? `${p.name} · бот` : p.name;
    const lines = [`*${escape(heading)}*`];
    for (const [key, label] of [['waiting', 'Ждут моего ревью'], ['authored', 'Мои открытые PR'], ['reviewed', 'Мои ревью за период'], ['merged', 'Мои влитые PR'], ['completed', 'Закрытые задачи']]) {
      if (!p[key].length) continue;
      lines.push(`*${label} · ${p[key].length}*`);
      if (key === 'merged') {
        const sameDetail = p.merged.every(row => row.detail === p.merged[0].detail);
        if (sameDetail) lines.push(p.merged[0].detail);
        lines.push(...p.merged.map(row => sameDetail ? row.line : `${row.line}\n    ${row.detail}`));
      } else lines.push(...p[key]);
    }
    textParts.push(lines.join('\n'));
    blocks.push({ type: 'divider' });
    let chunk = '';
    for (const line of lines) {
      if (line.length > 2800) throw new Error('One report item exceeds Slack section limit');
      if (chunk.length + line.length + 1 > 2800) {
        blocks.push({ type: 'section', text: { type: 'mrkdwn', text: chunk } });
        chunk = `*${escape(heading)} · продолжение*\n`;
      }
      chunk += `${chunk ? '\n' : ''}${line}`;
    }
    if (chunk) blocks.push({ type: 'section', text: { type: 'mrkdwn', text: chunk } });
  }
  if (!people.size) {
    blocks.push({ type: 'section', text: { type: 'plain_text', text: 'Нет открытых PR и завершённой работы за период.' } });
    textParts.push('Нет открытых PR и завершённой работы за период.');
  }
  const text = textParts.join('\n\n');
  if (text.length > 35000 || blocks.length > 50 || blocks.some(b => b.type === 'section' && b.text.text.length > 3000)) throw new Error('Update exceeds Slack message limits; reduce report scope');
  return { text, blocks };
}

export async function deliver(config, report, token, fetcher = fetch) {
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
  const method = config.messageTs ? 'chat.update' : 'chat.postMessage';
  const result = await slack(method, { channel: config.channel, ...report,
    ...(config.messageTs ? { ts: config.messageTs } : {}),
    mrkdwn: true, parse: 'none', link_names: false, unfurl_links: false, unfurl_media: false });
  if (result.channel !== config.channel || typeof result.ts !== 'string' || !/^\d+\.\d+$/.test(result.ts) || (config.messageTs && result.ts !== config.messageTs)) {
    throw new Error('Slack delivery was not confirmed; inspect channel before retrying');
  }
  return { channel: result.channel, ts: result.ts, until: config.until };
}

export async function run({ env = process.env, dryRun = false, request = github, fetcher = fetch, now = new Date() } = {}) {
  const config = configuration(env, now);
  if (!dryRun && !env.SLACK_BOT_TOKEN) throw new Error('SLACK_BOT_TOKEN is required for delivery');
  const report = render(config, await collect(config, request));
  return dryRun ? { preview: report.text, blocks: report.blocks, since: config.since, until: config.until } : deliver(config, report, env.SLACK_BOT_TOKEN, fetcher);
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
