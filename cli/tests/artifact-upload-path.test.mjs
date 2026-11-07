import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const home = mkdtempSync(join(tmpdir(), 'jht-artifact-path-'));
process.env.JHT_HOME = home;
const { uploadFileToTeam } = await import('../src/commands/artifacts.js');
after(() => rmSync(home, { recursive: true }));

test('an unavailable host path says where to run the command, without exposing the path or ENOENT', () => {
  const file = join(home, 'Documents', 'Job Hunter Team', 'CV sintetico.pdf');
  const result = uploadFileToTeam(file);
  assert.equal(result.ok, false);
  assert.equal(result.code, 2);
  assert.match(result.error, /artifact_file_unavailable/);
  assert.match(result.error, /jht artifact upload <file> from the host terminal/);
  assert.match(result.error, /\/jht_user\//);
  assert.equal(result.error.includes(file), false);
  assert.equal(result.error.includes('ENOENT'), false);
});

test('the real command fails clearly for a path outside the visible files', () => {
  const file = join(home, 'outside mounted folder', 'CV sintetico.pdf');
  const entry = fileURLToPath(new URL('../bin/jht.js', import.meta.url));
  const run = spawnSync(process.execPath, [entry, 'artifact', 'upload', file], {
    encoding: 'utf8', env: { ...process.env, HOME: home, JHT_HOME: home, NO_COLOR: '1' },
  });
  assert.equal(run.status, 2, run.stderr);
  assert.match(run.stderr, /artifact_file_unavailable/);
  assert.match(run.stderr, /host terminal/);
  assert.match(run.stderr, /\/jht_user\//);
  assert.equal(run.stderr.includes(file), false);
  assert.equal(run.stderr.includes('ENOENT'), false);
});

test('an unreadable file keeps the failure and explains the file prerequisite', () => {
  const result = uploadFileToTeam(home);
  assert.equal(result.ok, false);
  assert.equal(result.code, 2);
  assert.match(result.error, /readable file/);
  assert.match(result.error, /host terminal/);
  assert.equal(result.error.includes(home), false);
});
