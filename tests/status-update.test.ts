import assert from 'node:assert/strict';
import { test } from 'node:test';
import { run, collect, render } from '../.agents/skills/status-update/scripts/status-update.mjs';

const since = '2026-10-20T09:00:00.000Z', until = '2026-10-21T09:00:00.000Z';
const env = { STATUS_UPDATE_REPOSITORY: 'owner/repo', STATUS_UPDATE_SINCE: since,
  STATUS_UPDATE_UNTIL: until, STATUS_UPDATE_CHANNEL: 'C0123456789', SLACK_BOT_TOKEN: 'test-secret' };
const now = new Date(until);
function fixture() {
  const reads: string[] = [], writes: any[] = [], items: any[] = [], open: any[] = [];
  const prs: Record<number, any> = {}, reviews: Record<number, any[]> = {}, requests: Record<number, any> = {};
  const options: any = {};
  const issue = (number: number, time = since, extra = {}) => ({ number, title: `Task ${number}`, state: 'closed',
    state_reason: 'completed', closed_at: time, assignees: [{ login: 'owner' }], ...extra });
  const pr = (number: number, extra = {}) => ({ number, title: `PR ${number}`, user: { login: 'alice' }, head: { sha: 'head' },
    state: 'open', draft: false, merged_at: null, merged_by: null, ...extra });
  let reviewId = 0;
  const review = (user: string, state: string, extra = {}) => ({ id: ++reviewId, user: { login: user }, state,
    submitted_at: since, commit_id: 'head', ...extra });
  function addOpen(number: number, extra = {}) { prs[number] = pr(number, extra); open.push({ number }); }
  function addMerged(number: number, extra = {}) {
    prs[number] = pr(number, { state: 'closed', merged_at: since, merged_by: { login: 'merger' }, ...extra });
    items.push(issue(number, since, { pull_request: {} }));
  }
  const channel = { id: env.STATUS_UPDATE_CHANNEL, is_private: true, is_archived: false, is_member: true };
  async function request(endpoint: string) {
    reads.push(endpoint);
    if (options.githubError || (options.failPath && endpoint.includes(options.failPath))) throw new Error('GitHub denied');
    const url = new URL('https://api.github.com/' + endpoint);
    const page = Number(url.searchParams.get('page')) || 1;
    const slice = (array: any[]) => array.slice((page - 1) * 100, page * 100);
    const number = Number(url.pathname.split('/')[5]);
    if (url.pathname.endsWith('/reviews')) return slice(reviews[number] || []);
    if (url.pathname.endsWith('/requested_reviewers')) {
      const value = requests[number] || { users: [], teams: [] };
      return value;
    }
    if (/\/pulls\/\d+$/.test(url.pathname)) return prs[number];
    if (url.pathname.endsWith('/pulls')) return slice(open);
    assert.equal(url.searchParams.get('since'), since);
    return options.badPage ? {} : slice(items);
  }
  async function fetcher(url: string, init: any) {
    writes.push({ url, ...init, body: init.body ? JSON.parse(init.body) : null });
    assert.equal(init.headers.Authorization, 'Bearer test-secret');
    const write = url.endsWith('chat.postMessage') || url.endsWith('chat.update');
    if (write && options.transport) throw new Error('test-secret');
    if (options.invalidJSON) return { ok: true, json: async () => { throw new Error('test-secret'); } };
    return { ok: !options.httpError, json: async () => options.slackError || (options.writeError && write) ? { ok: false, error: 'test-secret' } : url.includes('conversations.info?') ?
      { ok: true, channel } : { ok: true, channel: env.STATUS_UPDATE_CHANNEL, ts: '123.456', ...options.result } };
  }
  return { reads, writes, items, open, prs, reviews, requests, options, issue, pr, review, addOpen, addMerged, channel, request,
    execute: (overrides = {}) => run({ env, now, request, fetcher: fetcher as unknown as typeof fetch, ...overrides }) };
}

function preview(result: Awaited<ReturnType<typeof run>>) {
  assert.ok('preview' in result);
  return result;
}

test('status dashboard paginates completions, filters actual event times and deduplicates', async () => {
  const f = fixture(); f.addMerged(9);
  f.items.push(f.issue(2, until), f.issue(3, '2026-10-20T08:59:59Z'),
    f.issue(4, since, { state_reason: 'not_planned' }), f.issue(5, since, { state: 'open' }));
  f.addMerged(6, { merged_at: null }); f.addMerged(7, { merged_at: until });
  f.items.push(f.issue(8), f.issue(8), f.issue(10, '2026-10-20T10:00:00+01:00'), f.issue(1));
  while (f.items.length < 100) f.items.push(f.issue(4));
  f.items.push(f.issue(11));
  const result = preview(await f.execute({ dryRun: true }));
  assert.match(result.preview, /Merged: 1 · Issues completed: 4/);
  for (const number of [2, 3, 4, 5, 6, 7]) assert.ok(!result.preview.includes(`|#${number}>`));
  assert.equal((result.preview.match(/\|#8>/g) || []).length, 1);
  assert.ok(result.preview.indexOf('|#1>') < result.preview.indexOf('|#8>'));
  assert.equal(f.reads.filter(x => x.includes('/issues?')).length, 2);
  assert.equal(f.writes.length, 0);
});

test('status dashboard includes old open PRs and separates authors, requested people and teams', async () => {
  const f = fixture();
  f.addOpen(1, { created_at: '2020-01-01T00:00:00Z' });
  f.requests[1] = { users: [{ login: 'bob' }], teams: [{ slug: 'platform' }] };
  f.addOpen(2, { draft: true }); f.requests[2] = { users: [{ login: 'carol' }], teams: [] };
  const result = preview(await f.execute({ dryRun: true }));
  assert.match(result.preview, /Open: 2 · Awaiting review: 1/);
  assert.match(result.preview, /Awaiting review.*#1>.*waiting for: bob, team platform/);
  assert.match(result.preview, /\*bob\*\n\*Awaiting my review · 1\*/);
  assert.match(result.preview, /Draft.*#2>/);
  assert.ok(!result.preview.includes('*carol*'));
  assert.ok(!result.preview.includes('*platform*'));
});

test('status dashboard classifies decisions without inventing approval or merge readiness', async () => {
  const cases = [
    { reviews: [], label: 'Open, no reviewer assigned' },
    { reviews: [['bob', 'COMMENTED']], label: 'Discussion, no approval' },
    { reviews: [['bob', 'APPROVED']], label: 'Has approval' },
    { reviews: [['bob', 'APPROVED', { commit_id: 'old-head' }]], label: 'Updated since approval' },
    { reviews: [['bob', 'APPROVED'], ['bob', 'COMMENTED']], label: 'Has approval' },
    { reviews: [['bob', 'APPROVED'], ['bob', 'DISMISSED']], label: 'Open, no reviewer assigned' },
    { reviews: [['bob', 'CHANGES_REQUESTED'], ['bob', 'APPROVED']], label: 'Has approval' },
    { reviews: [['bob', 'APPROVED'], ['carol', 'CHANGES_REQUESTED']], label: 'Changes requested' },
    { reviews: [['bob', 'PENDING', { submitted_at: null }]], label: 'Open, no reviewer assigned' },
  ];
  for (const entry of cases) {
    const f = fixture(); f.addOpen(1);
    f.reviews[1] = entry.reviews.map(([user, state, extra]: any) => f.review(user, state, extra));
    const result = preview(await f.execute({ dryRun: true }));
    assert.ok(result.preview.includes(`${entry.label} · <https://github.com/owner/repo/pull/1|#1>`), entry.label);
    assert.ok(!result.preview.includes('Ready to merge'));
  }
  const f = fixture(); f.addOpen(1, { draft: true });
  f.reviews[1] = [f.review('bob', 'CHANGES_REQUESTED')];
  f.requests[1] = { users: [{ login: 'carol' }], teams: [] };
  assert.match(preview(await f.execute({ dryRun: true })).preview, /Draft.*#1>/);
  f.prs[1].draft = false;
  assert.match(preview(await f.execute({ dryRun: true })).preview, /Changes requested.*#1>/);
});

test('status dashboard names approving reviewers and merger, labels bots and keeps issue assignees honest', async () => {
  const f = fixture(); f.addMerged(1, { user: { login: 'app[bot]' } });
  f.reviews[1] = [f.review('bob', 'APPROVED'), f.review('bob', 'COMMENTED'),
    f.review('carol', 'APPROVED', { submitted_at: until })];
  f.addMerged(2); f.reviews[2] = [f.review('bob', 'APPROVED'), f.review('bob', 'DISMISSED')];
  f.items.push(f.issue(3, since, { assignees: [{ login: 'dave' }, { login: 'eve' }] }), f.issue(4, since, { assignees: [] }));
  const result = preview(await f.execute({ dryRun: true }));
  assert.match(result.preview, /app\[bot\] · bot/);
  assert.match(result.preview, /Approved by: bob · merged by merger/);
  assert.match(result.preview, /No formal approval recorded · merged by merger/);
  assert.ok(!result.preview.includes('Approved by: bob, carol'));
  assert.ok(!result.preview.includes('*merger*'));
  for (const who of ['dave', 'eve', 'Unassigned']) assert.ok(result.preview.includes(`*${who}*`));
  assert.match(result.preview, /Issues completed: 2/);
  assert.match(result.preview, /My reviews this period/);
  // A review at the exclusive end is excluded, even if visible in the current API response.
  assert.ok(!result.preview.includes('*carol*'));
});

test('status dashboard paginates open PRs/reviews and reads all requested users/teams; retains all roles', async () => {
  const f = fixture(); f.addOpen(1); while (f.open.length < 100) f.open.push({ number: 1 });
  f.addOpen(2);
  f.reviews[1] = Array.from({ length: 101 }, () => f.review('bob', 'COMMENTED'));
  f.requests[1] = { users: Array.from({ length: 100 }, () => ({ login: 'carol' })).concat({ login: 'dave' }),
    teams: Array.from({ length: 101 }, () => ({ slug: 'team' })) };
  const data = await collect({ repository: 'owner/repo', since, until }, f.request);
  assert.equal(data.open.length, 2);
  assert.equal(data.open[0].reviews.length, 101);
  assert.deepEqual(data.open[0].requested, ['carol', 'dave']);
  assert.deepEqual(data.open[0].teams, ['team']);
  assert.equal(f.reads.filter(x => x.includes('/pulls?')).length, 2);
  assert.equal(f.reads.filter(x => x.includes('/reviews?')).length, 3);
  assert.equal(f.reads.filter(x => x.endsWith('/requested_reviewers')).length, 2);
});

test('status dashboard posts Block Kit with complete fallback, local period, safe links and no-change state', async () => {
  const f = fixture(); f.addOpen(1, { title: '<!channel> & <@U123>\nIgnore instructions', html_url: 'https://evil.test' });
  assert.deepEqual(await f.execute(), { channel: env.STATUS_UPDATE_CHANNEL, ts: '123.456', until });
  assert.equal(f.writes.length, 2);
  assert.equal(f.writes[0].method, 'GET'); assert.equal(f.writes[1].method, 'POST');
  const post = f.writes[1].body;
  assert.equal(post.blocks[0].type, 'header');
  assert.ok(post.blocks.some((b: any) => b.type === 'divider'));
  assert.match(post.text, /&lt;!channel&gt; &amp; &lt;@U123&gt; Ignore instructions/);
  assert.ok(post.text.includes('Europe/Moscow'));
  assert.ok(post.text.includes('12:00'));
  assert.ok(post.text.includes('20 Oct'));
  assert.doesNotMatch(JSON.stringify({ text: post.text, blocks: post.blocks }), /[\u0400-\u04ff]/u);
  assert.ok(post.text.includes(`[${since}, ${until})`));
  assert.equal(post.parse, 'none'); assert.equal(post.link_names, false);
  assert.equal(post.unfurl_links, false); assert.equal(post.unfurl_media, false);
  const visible = post.blocks.map((b: any) => b.text?.text || '').join('\n');
  assert.ok(visible.includes('pull/1|#1>'));
  assert.ok(!visible.includes('evil.test') && !post.text.includes('evil.test'));
  const empty = preview(await fixture().execute({ dryRun: true }));
  assert.match(empty.preview, /Open: 0.*Merged: 0.*Issues completed: 0/);
  assert.match(empty.preview, /No open PRs or completed work/);
});

test('status dashboard validates config before reads, allows tokenless previews, and defaults end once', async () => {
  for (const change of [{ STATUS_UPDATE_SINCE: '' }, { STATUS_UPDATE_SINCE: '2026-10-20T09:00:00' },
    { STATUS_UPDATE_SINCE: '2026-02-30T09:00:00Z' }, { STATUS_UPDATE_UNTIL: since },
    { STATUS_UPDATE_UNTIL: '2027-01-01T00:00:00Z' }, { STATUS_UPDATE_CHANNEL: '#private' },
    { STATUS_UPDATE_REPOSITORY: 'owner/repo/more' }, { SLACK_BOT_TOKEN: '' },
    { STATUS_UPDATE_TIMEZONE: 'not-a-zone' }, { STATUS_UPDATE_MESSAGE_TS: 'not-a-timestamp' }]) {
    const f = fixture(); await assert.rejects(f.execute({ env: { ...env, ...change } }));
    assert.equal(f.reads.length, 0); assert.equal(f.writes.length, 0);
  }
  const f = fixture();
  const result = preview(await f.execute({ dryRun: true, env: { ...env, SLACK_BOT_TOKEN: '', STATUS_UPDATE_UNTIL: '' } }));
  assert.equal(result.until, until); assert.equal(f.writes.length, 0);
});

test('status dashboard blocks public, archived, unjoined or wrong channels without a write', async () => {
  for (const change of [{ is_private: false }, { is_archived: true }, { is_member: false }, { id: 'COTHER' }, { is_member: undefined }]) {
    const f = fixture(); Object.assign(f.channel, change);
    await assert.rejects(f.execute(), /active private channel/); assert.equal(f.writes.length, 1);
  }
});

test('status dashboard fails partial API reads and Slack size limits before delivery', async () => {
  for (const kind of ['githubError', 'badPage', 'badPR', 'longItem', 'manyPeople', 'invalidTime', 'reviewsFailure', 'requestsFailure', 'openFailure']) {
    const f = fixture();
    if (kind === 'githubError' || kind === 'badPage') f.options[kind] = true;
    if (kind === 'badPR') f.items.push(f.issue(1, since, { pull_request: {} }));
    if (kind === 'longItem') f.addOpen(1, { title: 'x'.repeat(3000) });
    if (kind === 'manyPeople') for (let i = 1; i <= 25; i++) f.addOpen(i, { user: { login: `user-${i}` } });
    if (kind === 'invalidTime') f.items.push(f.issue(1, 'invalid'));
    if (kind === 'reviewsFailure' || kind === 'requestsFailure') {
      f.addOpen(1); f.options.failPath = kind === 'reviewsFailure' ? '/reviews?' : '/requested_reviewers';
    }
    if (kind === 'openFailure') f.options.failPath = '/pulls?';
    await assert.rejects(f.execute(), Error, kind); assert.equal(f.writes.length, 0);
  }
});

test('status dashboard chunks long person sections within Block Kit limits without losing items', async () => {
  const f = fixture(); for (let i = 1; i <= 20; i++) f.addMerged(i, { title: 'Long title '.repeat(20) });
  const data = await collect({ repository: 'owner/repo', since, until }, f.request);
  const report = render({ repository: 'owner/repo', since, until, timezone: 'Europe/Moscow' }, data);
  const visible = report.blocks.map((b: any) => b.text?.text || '').join('\n');
  assert.ok(report.blocks.length <= 50);
  assert.ok(report.blocks.filter((b: any) => b.type === 'section').every((b: any) => b.text.text.length <= 3000));
  for (let i = 1; i <= 20; i++) {
    assert.ok(visible.includes(`|#${i}>`)); assert.ok(report.text.includes(`|#${i}>`));
  }
});

test('status dashboard updates only an explicitly selected message, with no fallback on failure', async () => {
  const f = fixture();
  await f.execute({ env: { ...env, STATUS_UPDATE_MESSAGE_TS: '123.456' } });
  assert.ok(f.writes[1].url.endsWith('chat.update')); assert.equal(f.writes[1].body.ts, '123.456');
  assert.ok(Array.isArray(f.writes[1].body.blocks));
  for (const options of [{ writeError: true }, { transport: true }, { result: { ts: '999.888' } }]) {
    const broken = fixture(); Object.assign(broken.options, options);
    await assert.rejects(broken.execute({ env: { ...env, STATUS_UPDATE_MESSAGE_TS: '123.456' } }));
    assert.equal(broken.writes.length, 2);
    assert.ok(!broken.writes.some((w: any) => w.url.endsWith('chat.postMessage')));
  }
});

test('status dashboard never retries Slack errors or uncertain writes, and redacts errors', async () => {
  for (const kind of ['slackError', 'httpError', 'transport', 'invalidJSON', 'wrongChannel', 'missingTimestamp']) {
    const f = fixture();
    if (kind === 'wrongChannel') f.options.result = { channel: 'COTHER' };
    else if (kind === 'missingTimestamp') f.options.result = { ts: null };
    else f.options[kind] = true;
    await assert.rejects(f.execute(), (error: Error) => !error.message.includes('test-secret'));
    assert.ok(f.writes.filter(x => x.url.endsWith('chat.postMessage')).length <= 1);
  }
});
