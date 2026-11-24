// What rewrites cloud.json must not undo a pause that came in meanwhile, and must not change who owns the file (JHT-T335).
// Offline, invented data; the owners are faked through the `io` the writer takes, because a test cannot give a file away.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
  migrateSyncChoice, pauseCloud, resumeCloud, saveRefreshToken, writeCloudFile,
} from '../src/lib/cloud-sync-pause.js';

const PAIRED = Object.freeze({
  enabled: true, base_url: 'http://127.0.0.1:9', token: 'jht_sync_invented_token_for_the_tests_0000',
  user_id: '00000000-0000-4000-8000-000000000001', sync_choice: 'user',
  supabase_url: 'http://127.0.0.1:9', supabase_refresh_token: 'refresh-old',
});

function cloudFile(config = PAIRED) {
  const dir = mkdtempSync(join(tmpdir(), 'jht-cloud-file-'));
  const file = join(dir, 'cloud.json');
  writeFileSync(file, JSON.stringify(config, null, 2), { mode: 0o600 });
  return { dir, file };
}
const read = (file) => JSON.parse(readFileSync(file, 'utf8'));
const mode = (file) => statSync(file).mode & 0o777;
const realStat = (file) => statSync(file, { throwIfNoEntry: false });
// an io where the file belongs to uid 1001 and this process runs as `me`
const fakeOwner = (me, calls = []) => ({
  getuid: () => me,
  statSync: (file) => { const s = realStat(file); return s && { uid: 1001, gid: 1001, ino: s.ino }; },
  chownSync: (file, uid, gid) => calls.push([file, uid, gid]),
});

test('a) the rotated token is written alone: the rest of the file is what the file holds, not what was read first', () => {
  const { file } = cloudFile();
  assert.equal(saveRefreshToken(file, 'refresh-new'), 'written');
  assert.deepEqual(read(file), { ...PAIRED, supabase_refresh_token: 'refresh-new' });
  assert.equal(mode(file), 0o600);
});

test('a) a pause that lands between the first read and the write stays, and the token is still saved', () => {
  const { file } = cloudFile();
  assert.equal(saveRefreshToken(file, 'refresh-new', { beforeWrite: () => assert.equal(pauseCloud(file).ok, true) }), 'written');
  const after = read(file);
  assert.equal(after.enabled, false, 'the rotation put enabled back on');
  assert.equal(after.paused_by, 'cli');
  assert.match(after.paused_at, /^\d{4}-\d\d-\d\dT/);
  assert.equal(after.supabase_refresh_token, 'refresh-new');
  assert.equal(after.token, PAIRED.token);
  assert.equal(mode(file), 0o600);
});

test('a) and a resume that lands there stays too', () => {
  const { file } = cloudFile({ ...PAIRED, enabled: false, paused_at: '2026-11-24T10:00:00.000Z', paused_by: 'cli' });
  saveRefreshToken(file, 'refresh-new', { beforeWrite: () => assert.equal(resumeCloud(file).ok, true) });
  const after = read(file);
  assert.deepEqual([after.enabled, 'paused_at' in after, after.supabase_refresh_token], [true, false, 'refresh-new']);
});

test('a) control: writing back what was read first, as the rotation used to, does lose the pause', () => {
  const { file } = cloudFile();
  const stale = read(file);
  pauseCloud(file);
  writeFileSync(file, JSON.stringify({ ...stale, supabase_refresh_token: 'refresh-new' }));
  assert.equal(read(file).enabled, true); // the failure the test above rules out
});

test('a) persistRefreshToken, the real one, keeps a paused file paused', () => {
  const { dir, file } = cloudFile();
  assert.equal(pauseCloud(file).ok, true);
  const probe = `
    import { persistRefreshToken } from ${JSON.stringify(resolve(import.meta.dirname, '../src/lib/cloud-realtime.js'))};
    await persistRefreshToken('refresh-rotated');
  `;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
    encoding: 'utf8', env: { ...process.env, JHT_HOME: dir, HOME: dir },
  });
  assert.equal(r.status, 0, r.stderr);
  const after = read(file);
  assert.deepEqual([after.enabled, after.supabase_refresh_token, after.paused_by], [false, 'refresh-rotated', 'cli']);
  assert.equal(mode(file), 0o600);
});

test('c) the same user rewrites atomically, with the private mode', () => {
  const { file } = cloudFile();
  assert.equal(writeCloudFile(file, { ...PAIRED, enabled: false }), 'written');
  assert.equal(read(file).enabled, false);
  assert.equal(mode(file), 0o600);
});

test('c) a file of another user, written by a user who is not root: rewritten in place, same file, same mode', () => {
  const { file } = cloudFile();
  chmodSync(file, 0o640);
  const before = realStat(file);
  assert.equal(writeCloudFile(file, { ...PAIRED, enabled: false }, fakeOwner(501)), 'written');
  const after = realStat(file);
  assert.equal(after.ino, before.ino, 'the file was replaced: its owner would be the writer');
  assert.equal(after.mode & 0o777, 0o640);
  assert.equal(read(file).enabled, false);
});

test('c) a file of another user, written by root: replaced, and given back to its owner', () => {
  const { file } = cloudFile();
  const calls = [];
  assert.equal(writeCloudFile(file, { ...PAIRED, enabled: false }, fakeOwner(0, calls)), 'written');
  assert.deepEqual(calls, [[file, 1001, 1001]]);
  assert.equal(read(file).enabled, false);
});

test('c) a file of another user that cannot be written: nothing is written, and the migration says why', { skip: process.getuid?.() === 0 }, () => {
  const legacy = { ...PAIRED };
  delete legacy.sync_choice;
  const { file } = cloudFile(legacy);
  chmodSync(file, 0o400);
  const io = fakeOwner(501);
  assert.equal(writeCloudFile(file, { ...legacy, enabled: false }, io), 'foreign-owner');
  assert.deepEqual(migrateSyncChoice(file, { io }), { migrated: false, skipped: 'foreign-owner' });
  assert.deepEqual(pauseCloud(file, { io }), { ok: false, reason: 'foreign-owner' });
  assert.deepEqual(resumeCloud(file, { io }), { ok: false, reason: 'foreign-owner' });
  chmodSync(file, 0o600);
  assert.deepEqual(read(file), legacy, 'the file changed');
});

test('c) a link where the file should be is never followed, whoever writes', () => {
  const { dir, file } = cloudFile();
  const target = join(dir, 'elsewhere.json');
  writeFileSync(target, '{"keep":true}\n');
  const linked = join(dir, 'linked.json');
  symlinkSync(target, linked);
  const io = { getuid: () => 501, statSync: () => ({ uid: 1001, gid: 1001 }), chownSync() {} };
  assert.equal(writeCloudFile(linked, { ...PAIRED }, io), 'foreign-owner');
  assert.equal(readFileSync(target, 'utf8'), '{"keep":true}\n');
  void file;
});
