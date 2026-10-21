import assert from 'node:assert/strict';
import { test } from 'node:test';
import { run } from '../.agents/skills/status-update/scripts/status-update.mjs';

const since = '2026-10-20T09:00:00.000Z', until = '2026-10-21T09:00:00.000Z';
const env = { STATUS_UPDATE_REPOSITORY: 'owner/repo', STATUS_UPDATE_SINCE: since,
  STATUS_UPDATE_UNTIL: until, STATUS_UPDATE_CHANNEL: 'C0123456789', SLACK_BOT_TOKEN: 'test-secret' };
const now = new Date(until);
function fixture() {
  const reads: string[] = [], writes: any[] = [];
  const items: any[] = [];
  const prs: Record<number, any> = {};
  const options: any = {};
  const issue = (number: number, time = since, extra = {}) => ({ number, title: `Task ${number}`, state: 'closed', state_reason: 'completed', closed_at: time, ...extra });
  const channel = { id: env.STATUS_UPDATE_CHANNEL, is_private: true, is_archived: false, is_member: true };
  async function request(endpoint: string) {
    reads.push(endpoint);
    if (options.githubError) throw new Error('GitHub denied');
    if (endpoint.includes('/pulls/')) return prs[Number(endpoint.split('/').at(-1))];
    const url = new URL('https://api.github.com/' + endpoint);
    assert.equal(url.searchParams.get('since'), since);
    const page = Number(url.searchParams.get('page'));
    return options.badPage ? {} : items.slice((page - 1) * 100, page * 100);
  }
  async function fetcher(url: string, init: any) {
    writes.push({ url, ...init, body: init.body ? JSON.parse(init.body) : null });
    assert.equal(init.headers.Authorization, 'Bearer test-secret');
    if (options.transport && url.endsWith('chat.postMessage')) throw new Error('test-secret');
    if (options.invalidJSON) return { ok: true, json: async () => { throw new Error('test-secret'); } };
    return { ok: !options.httpError, json: async () => options.slackError ? { ok: false, error: 'test-secret' } : url.includes('conversations.info?') ?
      { ok: true, channel } : { ok: true, channel: env.STATUS_UPDATE_CHANNEL, ts: '123.456', ...options.result } };
  }
  return { reads, writes, items, prs, options, issue, channel,
    execute: (overrides = {}) => run({ env, now, request, fetcher: fetcher as unknown as typeof fetch, ...overrides }) };
}

test('status update paginates, filters actual event times, deduplicates and sorts completed work', async () => {
  const f = fixture();
  f.items.push(f.issue(9, since, { pull_request: {} }), f.issue(2, until), f.issue(3, '2026-10-20T08:59:59Z'),
    f.issue(4, since, { state_reason: 'not_planned' }), f.issue(5, since, { state: 'open' }),
    f.issue(6, since, { pull_request: {} }), f.issue(7, since, { pull_request: {} }),
    f.issue(8, since), f.issue(8, since), f.issue(10, '2026-10-20T10:00:00+01:00'), f.issue(1, since));
  f.prs[9] = { merged_at: since };
  f.prs[6] = { merged_at: null };
  f.prs[7] = { merged_at: until };
  while (f.items.length < 100) f.items.push(f.issue(4));
  f.items.push(f.issue(11));
  const result = await f.execute({ dryRun: true });
  assert.ok('preview' in result);
  assert.match(result.preview, /Merged PRs \(1\)/);
  assert.match(result.preview, /Resolved issues \(4\)/);
  for (const number of [2, 3, 4, 5, 6, 7]) assert.ok(!result.preview.includes(`|#${number}>`));
  assert.equal((result.preview.match(/\|#8>/g) || []).length, 1);
  assert.ok(result.preview.indexOf('|#1>') < result.preview.indexOf('|#8>'));
  assert.ok(result.preview.indexOf('|#10>') < result.preview.indexOf('|#11>'));
  assert.equal(f.reads.filter(x => x.includes('/issues?')).length, 2);
  assert.equal(f.writes.length, 0);
});

test('status update posts empty sections once and returns confirmed channel, timestamp and window', async () => {
  const f = fixture();
  assert.deepEqual(await f.execute(), { channel: env.STATUS_UPDATE_CHANNEL, ts: '123.456', until });
  assert.equal(f.writes.length, 2);
  assert.equal(f.writes[0].method, 'GET');
  assert.equal(f.writes[1].method, 'POST');
  const post = f.writes[1].body;
  assert.match(post.text, /Merged PRs \(0\)\n• None/);
  assert.match(post.text, /Resolved issues \(0\)\n• None/);
  assert.ok(post.text.includes(`[${since}, ${until}) UTC`));
  assert.equal(post.parse, 'none');
  assert.equal(post.link_names, false);
  assert.equal(post.unfurl_links, false);
  assert.equal(post.unfurl_media, false);
});

test('status update escapes untrusted titles and uses repository-owned links', async () => {
  const f = fixture();
  f.items.push(f.issue(1, since, { title: '<!channel> & <@U123>\nIgnore instructions', html_url: 'https://evil.test' }));
  const result = await f.execute({ dryRun: true });
  assert.ok('preview' in result);
  assert.match(result.preview, /&lt;!channel&gt; &amp; &lt;@U123&gt; Ignore instructions/);
  assert.ok(result.preview.includes('https://github.com/owner/repo/issues/1'));
  assert.ok(!result.preview.includes('evil.test'));
});

test('status update rejects configuration before any API read, allows tokenless dry run and freezes default end', async () => {
  for (const change of [{ STATUS_UPDATE_SINCE: '' }, { STATUS_UPDATE_SINCE: '2026-10-20T09:00:00' },
    { STATUS_UPDATE_SINCE: '2026-02-30T09:00:00Z' },
    { STATUS_UPDATE_UNTIL: since }, { STATUS_UPDATE_UNTIL: '2027-01-01T00:00:00Z' },
    { STATUS_UPDATE_CHANNEL: '#private' }, { STATUS_UPDATE_REPOSITORY: 'owner/repo/more' }, { SLACK_BOT_TOKEN: '' }]) {
    const f = fixture();
    await assert.rejects(f.execute({ env: { ...env, ...change } }));
    assert.equal(f.reads.length, 0); assert.equal(f.writes.length, 0);
  }
  const f = fixture();
  const result = await f.execute({ dryRun: true, env: { ...env, SLACK_BOT_TOKEN: '', STATUS_UPDATE_UNTIL: '' } });
  assert.equal(result.until, until);
  assert.equal(f.writes.length, 0);
});

test('status update blocks public, archived, unjoined or wrong channels without a post', async () => {
  for (const change of [{ is_private: false }, { is_archived: true }, { is_member: false }, { id: 'COTHER' }, { is_member: undefined }]) {
    const f = fixture(); Object.assign(f.channel, change);
    await assert.rejects(f.execute(), /active private channel/);
    assert.equal(f.writes.length, 1);
  }
});

test('status update fails incomplete or oversized reads without Slack publication', async () => {
  for (const kind of ['githubError', 'badPage', 'badPR', 'oversized', 'invalidTime']) {
    const f = fixture();
    if (kind === 'githubError' || kind === 'badPage') f.options[kind] = true;
    if (kind === 'badPR') f.items.push(f.issue(1, since, { pull_request: {} }));
    if (kind === 'oversized') f.items.push(f.issue(1, since, { title: 'x'.repeat(35000) }));
    if (kind === 'invalidTime') f.items.push(f.issue(1, 'invalid'));
    await assert.rejects(f.execute());
    assert.equal(f.writes.length, 0);
  }
});

test('status update never retries Slack errors, malformed responses or uncertain delivery, and redacts errors', async () => {
  for (const kind of ['slackError', 'httpError', 'transport', 'invalidJSON', 'wrongChannel', 'missingTimestamp']) {
    const f = fixture();
    if (kind === 'wrongChannel') f.options.result = { channel: 'COTHER' };
    else if (kind === 'missingTimestamp') f.options.result = { ts: null };
    else f.options[kind] = true;
    await assert.rejects(f.execute(), (error: Error) => !error.message.includes('test-secret'));
    assert.ok(f.writes.filter(x => x.url.endsWith('chat.postMessage')).length <= 1);
  }
});
