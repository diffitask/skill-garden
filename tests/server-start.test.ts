import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = fileURLToPath(new URL('../skill-atlas', import.meta.url));

for (const command of ['npm start', 'skill-atlas web']) {
  test(`${command} serves a persistent localhost view without building HTML`, { timeout: 15000 }, async (t) => {
    const child = command === 'npm start'
      ? spawn('npm', ['start'], { cwd: root, env: { ...process.env, PORT: '0' }, detached: true })
      : spawn(cli, ['web'], { cwd: tmpdir(), env: { ...process.env, PORT: '0' }, detached: true });
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) {
        const closed = once(child, 'close');
        process.kill(-child.pid!, 'SIGINT');
        await closed;
      }
    });
    let stdout = '';
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const base = await new Promise<string>((resolve, reject) => {
      child.on('error', reject);
      child.on('exit', () => reject(new Error(`Server exited before startup: ${stderr}`)));
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
        const url = /http:\/\/localhost:\d+/.exec(stdout)?.[0];
        if (url) resolve(url);
      });
    });
    assert.notEqual(new URL(base).port, '0');
    for (let reload = 0; reload < 2; reload++) {
      const response = await fetch(base);
      assert.equal(response.status, 200);
      assert.match(await response.text(), /Skill Atlas/);
    }
    for (const path of ['/app.js', '/style.css']) {
      assert.equal((await fetch(base + path)).status, 200);
    }
    const invalid = await fetch(base + '/api/scan?repository=invalid');
    assert.equal(invalid.status, 400);
    assert.equal(child.exitCode, null);
    assert.equal(stderr, '');
  });
}

test('web command appears in help and rejects extra arguments', () => {
  const help = spawnSync(cli, ['help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /web\s+start the local web view/);
  const extra = spawnSync(cli, ['web', 'unexpected'], { encoding: 'utf8' });
  assert.equal(extra.status, 1);
});

test('invalid ports fail with actionable output', () => {
  for (const port of ['abc', '-1', '65536', '3.5', '']) {
    const child = spawnSync(cli, ['web'], { env: { ...process.env, PORT: port }, encoding: 'utf8' });
    assert.equal(child.status, 1);
    assert.match(child.stderr, /PORT must be an integer between 0 and 65535/);
    assert.doesNotMatch(child.stderr, /at .*\.ts:/);
  }
});

test('occupied port reports how to recover and exits with code 1', async (t) => {
  const server = createServer();
  t.after(() => server.close());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const child = spawn(cli, ['web'], {
    env: { ...process.env, PORT: String((server.address() as AddressInfo).port) },
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const [code] = await once(child, 'close');
  assert.equal(code, 1);
  assert.match(stderr, /already in use.*set PORT/);
});
