import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const executable = join(root, 'skill-atlas');
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('--version prints the package version and a newline, with exit code 0', () => {
  const result = spawnSync(executable, ['--version'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `${version}\n`);
  assert.equal(result.stderr, '');
});

test('--version works outside the checkout without scanning, network requests, or file writes', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'skill-atlas-version-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  // Deny all file writes and reads outside the installation. The scanner's network
  // transport must never be called, even when a GitHub token is present.
  const guard = 'globalThis.fetch = () => { throw new Error("Unexpected network request"); };';
  const result = spawnSync(executable, ['--version'], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_TOKEN: 'test',
      NODE_OPTIONS: `--permission --allow-fs-read="${root}" --import=data:text/javascript,${encodeURIComponent(guard)}`,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `${version}\n`);
  assert.equal(result.stderr, '');
  assert.deepEqual(readdirSync(cwd), []);
});
