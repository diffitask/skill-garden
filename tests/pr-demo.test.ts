import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { openGitHub } from '../src/core/github.ts';
import { scan } from '../src/core/scan.ts';
import { openDirectory } from '../src/local.ts';
import { fakeGitHub } from '../.air/scripts/pr-demo/fake-github.mjs';
import { decodePNG, diffRegions, encodePNG } from '../.air/scripts/pr-demo/png.mjs';
import { publishDemo, LABEL } from '../.air/scripts/pr-demo/publish.mjs';
import { record, validateScenario } from '../.air/scripts/pr-demo/record.mjs';
import { FIXTURE } from './helpers.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function image(width: number, height: number, paint?: (x: number, y: number) => number[] | undefined) {
  const data = new Uint8Array(width * height * 4).fill(255);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const color = paint?.(x, y);
    if (color) data.set([...color, 255], (y * width + x) * 4);
  }
  return { width, height, data };
}

test('PNG round trip keeps every pixel, and RGB PNGs decode to opaque RGBA', () => {
  const original = image(37, 21, (x, y) => [x * 6, y * 12, (x + y) % 256]);
  const decoded = decodePNG(encodePNG(original));
  assert.equal(decoded.width, 37);
  assert.equal(decoded.height, 21);
  assert.deepEqual(decoded.data, original.data);
  assert.throws(() => decodePNG(Buffer.from('not a png')), /Not a PNG/);
});

test('diff regions: none for identical images, padded boxes for separate changes, merged when padding overlaps', () => {
  const base = image(200, 100);
  assert.deepEqual(diffRegions(base, image(200, 100)), []);
  const twoChanges = image(200, 100, (x, y) => (x >= 10 && x < 30 && y >= 10 && y < 20) || (x >= 150 && y >= 80) ? [255, 0, 0] : undefined);
  const regions = diffRegions(base, twoChanges);
  assert.equal(regions.length, 2);
  assert.deepEqual(regions[0], { x: 2, y: 2, width: 36, height: 28 });
  assert.ok(regions[1].x <= 150 && regions[1].x + regions[1].width === 200 && regions[1].y + regions[1].height === 100);
  // Two changes 8 pixels apart: separate cells, one outline once padded.
  const close = image(200, 100, (x, y) => y < 8 && (x < 8 || (x >= 16 && x < 24)) ? [0, 0, 0] : undefined);
  assert.equal(diffRegions(base, close).length, 1);
  // Antialiasing noise below the threshold is not a change.
  assert.deepEqual(diffRegions(base, image(200, 100, () => [250, 250, 250])), []);
  // A taller after image: the extra area counts as changed.
  const taller = diffRegions(base, image(200, 140));
  assert.equal(taller.length, 1);
  assert.equal(taller[0].y + taller[0].height, 140);
  assert.ok(taller[0].y <= 100);
});

test('fake GitHub serves the fixture as demo/skills, refuses unknown repositories and every other host', async () => {
  const fetch = fakeGitHub(FIXTURE);
  const demo = await scan(await openGitHub('https://github.com/demo/skills', { fetch }));
  const local = await scan(await openDirectory(FIXTURE));
  assert.equal(demo.repository.id, 'demo/skills');
  assert.deepEqual(demo.skills.map((s) => s.name), local.skills.map((s) => s.name));
  await assert.rejects(openGitHub('https://github.com/demo/missing', { fetch }), /Repository not found/);
  await assert.rejects(openGitHub('https://github.com/demo/limited', { fetch }), /rate limit/);
  await assert.rejects(fetch('https://example.com/'), /not available while recording/);
  assert.equal((await fetch(`https://raw.githubusercontent.com/demo/skills/${'de30'.repeat(10)}/..%2Fpackage.json`)).status, 404);
});

test('scenarios are validated before recording', () => {
  assert.throws(() => validateScenario({ steps: [] }), /needs steps/);
  assert.throws(() => validateScenario({ steps: [{ name: 'x', action: 'hover' }] }), /Unknown action/);
  assert.throws(() => validateScenario({ steps: [{ name: 'x', action: 'goto', url: 'https://example.com' }] }), /local url/);
  assert.throws(() => validateScenario({ steps: [{ name: 'a', action: 'goto', url: '/', moment: true }, { name: 'a', action: 'wait', moment: true }] }), /Duplicate moment/);
  // Resizing mid-recording is what shrank the page into a corner of the video.
  assert.throws(() => validateScenario({ steps: [{ name: 'Narrow', action: 'viewport', width: 390, height: 844 }] }), /fixed size/);
  assert.throws(() => validateScenario({ steps: [{ name: 'x', action: 'click' }] }), /needs a selector/);
  assert.throws(() => validateScenario({ steps: [{ name: 'x', action: 'wait', note: 'n'.repeat(91) }] }), /short hint/);
  assert.throws(() => validateScenario({ steps: [{ name: 'x', action: 'wait', focus: 3 }] }), /focus must be a selector/);
  for (const file of ['scenario.json', 'examples/word-filter.json']) {
    validateScenario(JSON.parse(readFileSync(join(ROOT, '.air/scripts/pr-demo', file), 'utf8')));
  }
});

/** A revision of the app: this repository's src with optional edits, sharing node_modules. */
async function revision(root: string, name: string, edit?: (dir: string) => Promise<void>) {
  const dir = join(root, name);
  await mkdir(dir);
  await cp(join(ROOT, 'src'), join(dir, 'src'), { recursive: true });
  await cp(join(ROOT, 'package.json'), join(dir, 'package.json'));
  await symlink(join(ROOT, 'node_modules'), join(dir, 'node_modules'));
  await edit?.(dir);
  return dir;
}

const scenario = {
  title: 'A new control',
  viewport: { width: 900, height: 700 },
  steps: [
    { name: 'Landing page', action: 'goto', url: '/', moment: true, note: 'The start page' },
    { name: 'Enter a repository', action: 'type', selector: '#repository', value: 'https://github.com/demo/skills' },
    { name: 'Scan', action: 'click', selector: '#scan' },
    { name: 'Results', action: 'wait', selector: '#results', focus: '#skills', moment: true, note: 'The skill list' },
    { name: 'New control', action: 'click', selector: '#new-control', focus: '#new-control', afterOnly: true, moment: true, note: 'New: a control' },
    { name: 'Missing step', action: 'click', selector: '#nowhere', moment: true },
  ],
};

/** What the recorded page shows at a moment: the overlay must never be in a screenshot. */
async function overlayVisible(file: string) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(`<img src="data:image/png;base64,${(await readFile(file)).toString('base64')}">`);
  const size = await page.evaluate(() => [document.images[0].naturalWidth, document.images[0].naturalHeight]);
  await browser.close();
  return size;
}

test('records both revisions with hints, a cursor and spotlights; moments are changed, new, unchanged or unavailable; no credentials', { timeout: 240000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pr-demo-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const leak = join(root, 'env.json');
  const before = await revision(root, 'before');
  const after = await revision(root, 'after', async (dir) => {
    const html = join(dir, 'src/web/index.html');
    await writeFile(html, (await readFile(html, 'utf8'))
      .replace('Explore a repository’s skills.', 'Explore every skill.')
      .replace('<h2 id="repo-name"></h2>', '<h2 id="repo-name"></h2><button id="new-control" type="button">New control</button>'));
    const server = join(dir, 'src/server.ts');
    // The PR's server reports the environment it was given.
    await writeFile(server, `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(leak)}, JSON.stringify(process.env));\n${await readFile(server, 'utf8')}`);
  });
  process.env.GITHUB_TOKEN = 'secret-token';
  t.after(() => { delete process.env.GITHUB_TOKEN; });
  const out = join(root, 'out');
  const manifest = await record({ before, after, out, scenario, speed: 0, timeout: 1500 });

  assert.equal(manifest.title, 'A new control');
  for (const label of ['before', 'after'] as const) {
    assert.match(manifest[label].video, /^(before|after)\.(mp4|webm)$/);
    assert.ok((await readFile(join(out, manifest[label].video))).length > 1000);
  }
  const [landing, results, control, missing] = manifest.moments;
  assert.deepEqual(manifest.moments.map((m: any) => m.number), [1, 2, 3, 4]);
  // No focus given: the detected change, one heading, is outlined automatically.
  assert.equal(landing.status, 'changed');
  assert.equal(landing.autoFocus, true);
  assert.ok(landing.focus.after.width < scenario.viewport.width / 2, 'outlines the heading, not the page');
  assert.equal(landing.note, 'The start page');
  // The author's focus: the element's box in both revisions.
  assert.equal(results.autoFocus, false);
  assert.ok(results.focus.before && results.focus.after);
  // Added by the PR: skipped before, shown after.
  assert.equal(control.status, 'new');
  assert.equal(control.focus.before, null);
  assert.ok(control.focus.after.width > 0);
  assert.equal(control.errors.before, null);
  assert.deepEqual(manifest.before.steps.find((s: any) => s.name === 'New control'), { name: 'New control', ok: false, skipped: true });
  // A step that fails in both versions.
  assert.equal(missing.status, 'unavailable');
  assert.match(missing.errors.before, /Timeout|waiting/);
  assert.equal(missing.image, null);
  for (const moment of [landing, results, control].filter((m: any) => m.image)) {
    const [width] = await overlayVisible(join(out, moment.image));
    assert.ok(width > 1300, 'before and after side by side at 2x');
  }
  // Screenshots are 2x and taken with the overlay hidden: the badge corner matches a plain page.
  const shot = decodePNG(await readFile(join(out, 'screens', 'after-01-landing-page.png')));
  assert.equal(shot.width, 1800);
  const corner = shot.data.subarray((shot.height - 30) * shot.width * 4 + 60 * 4, (shot.height - 30) * shot.width * 4 + 64 * 4);
  assert.ok([...corner].every((value) => value > 200), 'no revision badge in the screenshot');
  assert.deepEqual(JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8')), manifest);

  const env = JSON.parse(await readFile(leak, 'utf8'));
  assert.equal(env.GITHUB_TOKEN, undefined);
  assert.deepEqual(Object.keys(env).filter((k) => !['PATH', 'HOME', 'PORT', 'DEMO_FIXTURE'].includes(k) && !k.startsWith('NODE_')), []);
  assert.notEqual(env.HOME, process.env.HOME);

  // An identical recording has no changed moments and no images.
  const same = await record({ before, after: before, out: join(root, 'same'), scenario: { ...scenario, steps: scenario.steps.slice(0, 4) }, speed: 0 });
  assert.deepEqual(same.moments.map((m: any) => [m.status, m.image]), [['unchanged', null], ['unchanged', null]]);
});

test('a revision whose app does not start has no video and unavailable moments; the other is still recorded', { timeout: 120000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'pr-demo-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const before = await revision(root, 'before', (dir) => rm(join(dir, 'src/server.ts')));
  const after = await revision(root, 'after');
  const manifest = await record({ before, after, out: join(root, 'out'), scenario: { ...scenario, steps: scenario.steps.slice(0, 1) }, speed: 0 });
  assert.equal(manifest.before.video, null);
  assert.match(manifest.before.error, /exited|did not start/);
  assert.ok(manifest.after.video);
  assert.equal(manifest.moments[0].status, 'unavailable');
  assert.match(manifest.moments[0].errors.before, /exited|did not start/);
  assert.ok(manifest.moments[0].image, 'the after screenshot is still shown');
});

// Publishing, with gh answering from a fake PR.
const head = 'a'.repeat(40);
const base = 'b'.repeat(40);
const env = { DEMO_REPOSITORY: 'owner/repo', PR_NUMBER: '7', PR_HEAD_SHA: head, PR_BASE_SHA: base, DEMO_RUN_URL: 'https://air.example/run/1' };
const none = { before: null, after: null };

async function demoOutput(overrides: any = {}) {
  const out = await mkdtemp(join(tmpdir(), 'pr-demo-out-'));
  await mkdir(join(out, 'moments'));
  for (const file of ['before.mp4', 'after.mp4', 'moments/01-filter.png', 'moments/03-new.png', 'moments/04-broken.png']) await writeFile(join(out, file), 'x');
  const manifest = {
    title: 'Filter skills',
    before: { video: 'before.mp4', error: null }, after: { video: 'after.mp4', error: null },
    moments: [
      { number: 1, name: 'Filter field', note: 'New: a filter above the list', status: 'changed', autoFocus: false, otherChanges: 2, image: 'moments/01-filter.png', errors: none },
      { number: 2, name: 'Results', note: null, status: 'unchanged', image: null, errors: none },
      { number: 3, name: 'No matches', note: 'A clear message instead of an empty list', status: 'new', autoFocus: false, otherChanges: 0, image: 'moments/03-new.png', errors: none },
      { number: 4, name: 'Broken', note: null, beforeNote: 'Old layout', status: 'unavailable', autoFocus: true, otherChanges: 0, image: 'moments/04-broken.png',
        errors: { before: 'Timeout `5000ms`\nexceeded', after: null } },
    ],
    ...overrides,
  };
  await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest));
  return out;
}

function fakeGh({ pr = {}, comments = [] as any[], fail = false } = {}) {
  const calls: { args: string[]; cwd?: string }[] = [];
  const gh = async (args: string[], options?: { cwd?: string }) => {
    calls.push({ args, cwd: options?.cwd });
    if (args[0] === 'api' && args[1] === 'repos/owner/repo/pulls/7') {
      return JSON.stringify({ state: 'open', head: { sha: head }, labels: [{ name: LABEL }], ...pr });
    }
    if (args[0] === 'api' && args.includes('--slurp')) return JSON.stringify([comments, []]);
    if (args[0] === 'pr' && args[1] === 'comment') {
      if (fail) throw new Error('HTTP 403: upload refused');
      return 'https://github.com/owner/repo/pull/7#issuecomment-1\n';
    }
    throw new Error(`unexpected gh ${args.join(' ')}`);
  };
  return { gh, calls };
}

test('publishes one comment: a numbered list of what to look at, one outlined picture per change, and both videos as players', async () => {
  const out = await demoOutput();
  const { gh, calls } = fakeGh();
  const result = await publishDemo(env, out, gh);
  assert.deepEqual(result, { url: 'https://github.com/owner/repo/pull/7#issuecomment-1', attachments: 5 });
  const comment = calls.at(-1)!;
  assert.equal(comment.cwd, out);
  assert.deepEqual(comment.args, ['pr', 'comment', '7', '-R', 'owner/repo', '--body-file', './comment.md',
    '--attach', './moments/01-filter.png', '--attach', './moments/03-new.png', '--attach', './moments/04-broken.png',
    '--attach', './before.mp4', '--attach', './after.mp4']);
  const body = await readFile(join(out, 'comment.md'), 'utf8');
  assert.ok(body.startsWith(`<!-- air-pr-demo:${head} -->\n## PR demo: Filter skills`));
  assert.match(body, /before this PR \(`bbbbbbb`\) and with it \(`aaaaaaa`\)/);
  assert.match(body, /\*\*What to look at\*\*\n\n1\. \*\*Filter field\*\* \(changed\): New: a filter above the list\n3\. \*\*No matches\*\* \(new\): A clear message instead of an empty list\n4\. \*\*Broken\*\* \(could not compare\): Old layout\n\nSame as before: Results\./);
  assert.match(body, /### 1\. Filter field\n\n> New: a filter above the list\n\n!\[Filter field: before and with this PR, the change outlined in red\]\(\.\/moments\/01-filter\.png\)\n\n_2 more areas differ on this screen, see the video\._/);
  assert.match(body, /### 4\. Broken\n\n> Old layout\n\nCould not compare: before: `Timeout 5000ms exceeded`\./, 'PR error text is one line with no markup');
  assert.match(body, /_outlined automatically where the screens differ\._/);
  // A video alone in its paragraph is what gh turns into a player.
  assert.match(body, /\*\*Before this PR\*\* \(`bbbbbbb`\)\n\n!\[\]\(\.\/before\.mp4\)\n/);
  assert.match(body, /\*\*With this PR\*\* \(`aaaaaaa`\)\n\n!\[\]\(\.\/after\.mp4\)\n/);
  assert.match(body, /\[Automation run\]\(https:\/\/air\.example\/run\/1\)/);
});

test('a missing video is stated, and no changes are reported as such', async () => {
  const out = await demoOutput({
    before: { video: null, error: 'The app exited with code 1' },
    moments: [{ number: 1, name: 'Landing', status: 'unchanged', image: null, errors: none }],
  });
  const { gh, calls } = fakeGh();
  await publishDemo(env, out, gh);
  const body = await readFile(join(out, 'comment.md'), 'utf8');
  assert.match(body, /No visible changes in the recorded moments\./);
  assert.match(body, /Same as before: Landing\./);
  assert.match(body, /\*\*Before this PR\*\* \(`bbbbbbb`\)\n\nNo video: `The app exited with code 1`/);
  assert.deepEqual(calls.at(-1)!.args.filter((a) => a.startsWith('./') && a !== './comment.md'), ['./after.mp4']);
});

test('skips closed PRs, a changed head, a removed label, and a head that already has a demo unless forced', async () => {
  const out = await demoOutput();
  for (const [pr, reason] of [[{ state: 'closed' }, 'closed'], [{ head: { sha: 'c'.repeat(40) } }, 'head_changed'], [{ labels: [{ name: 'bug' }] }, 'label_missing']] as const) {
    const { gh, calls } = fakeGh({ pr });
    assert.deepEqual(await publishDemo(env, out, gh), { skipped: reason });
    assert.ok(!calls.some((c) => c.args[0] === 'pr'), 'nothing posted');
  }
  const existing = [{ body: 'unrelated' }, { body: `<!-- air-pr-demo:${head} -->\n## PR demo` }];
  const { gh, calls } = fakeGh({ comments: existing });
  assert.deepEqual(await publishDemo(env, out, gh), { skipped: 'already_published' });
  assert.ok(!calls.some((c) => c.args[0] === 'pr'));
  // A demo for an older head does not block the new one.
  const older = fakeGh({ comments: [{ body: `<!-- air-pr-demo:${base} -->` }] });
  assert.ok((await publishDemo(env, out, older.gh)).url);
  const forced = fakeGh({ comments: existing });
  assert.ok((await publishDemo({ ...env, DEMO_FORCE: '1' }, out, forced.gh)).url);
  assert.ok(!forced.calls.some((c) => c.args.includes('--slurp')));
});

test('publication validates its inputs and propagates GitHub failures without retrying', async () => {
  const out = await demoOutput();
  const { gh } = fakeGh();
  for (const [change, message] of [[{ DEMO_REPOSITORY: 'bad' }, /owner\/repo/], [{ PR_NUMBER: '0' }, /PR number/],
    [{ PR_HEAD_SHA: 'abc' }, /PR_HEAD_SHA/], [{ PR_BASE_SHA: undefined }, /PR_BASE_SHA/], [{ DEMO_RUN_URL: 'http://air.example' }, /run URL/]] as const) {
    await assert.rejects(publishDemo({ ...env, ...change }, out, gh), message);
  }
  await rm(join(out, 'moments/01-filter.png'));
  await assert.rejects(publishDemo(env, out, gh), /Missing image/);
  const failing = fakeGh({ fail: true });
  await assert.rejects(publishDemo(env, await demoOutput(), failing.gh), /upload refused/);
  assert.equal(failing.calls.filter((c) => c.args[0] === 'pr').length, 1);
});
