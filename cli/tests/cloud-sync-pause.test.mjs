// The sync with the site is a choice, and it can be paused without losing the pairing (JHT-T335).
// Every test is offline and runs on invented data: a CLI child gets a fetch that records the call and fails, and a
// test that finds the record fails («a paused sync must not reach the network»).
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { effectiveConfig, syncSwitch } from '../../shared/cloud/sync-switch.js';
import { isCloudConfigured } from '../src/commands/pid1.js';
import { migrateSyncChoice, pauseCloud, resumeCloud } from '../src/lib/cloud-sync-pause.js';
import { pushUsageSamples } from '../src/lib/usage-samples-push.js';

const JHT = resolve(import.meta.dirname, '../bin/jht.js');
const CASES = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../tests/fixtures/sync-switch-cases.json'), 'utf8'));
const TOKEN = 'jht_sync_invented_token_for_the_tests_0000';
const PAIRED = Object.freeze({
  enabled: true, base_url: 'http://127.0.0.1:9', token: TOKEN, user_id: '00000000-0000-4000-8000-000000000001',
  token_name: 'invented', enabled_at: '2026-11-01T10:00:00.000Z', sync_choice: 'user',
  supabase_url: 'http://127.0.0.1:9', supabase_refresh_token: 'invented-refresh',
});

function home(config) {
  const dir = mkdtempSync(join(tmpdir(), 'jht-sync-pause-'));
  const file = join(dir, 'cloud.json');
  if (config) writeFileSync(file, JSON.stringify(config, null, 2), { mode: 0o600 });
  const trap = join(dir, 'fetch-trap.cjs');
  writeFileSync(trap, [
    "const fs = require('node:fs');",
    "globalThis.fetch = () => { fs.appendFileSync(process.env.TRAP_FILE, 'fetch\\n'); return Promise.reject(new Error('fetch trap')); };",
  ].join('\n'));
  return { dir, file, trap, hit: join(dir, 'fetch-called') };
}

function env(h, extra = {}) {
  return { ...process.env, JHT_HOME: h.dir, HOME: h.dir, NO_COLOR: '1', JHT_LANG: 'en', TRAP_FILE: h.hit, JHT_CLOUD_SYNC: '', ...extra };
}

function jht(h, args, extra = {}) {
  const r = spawnSync(process.execPath, ['--require', h.trap, JHT, ...args], { encoding: 'utf8', timeout: 30000, env: env(h, extra) });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const rmHit = (h) => { try { unlinkSync(h.hit); } catch { /* none */ } };
const noFetch = (h, what) => assert.equal(existsSync(h.hit), false, `${what}: a paused sync reached the network`);
const read = (file) => JSON.parse(readFileSync(file, 'utf8'));
const mode = (file) => statSync(file).mode & 0o777;

test('1. pause keeps every field and the 0600 mode, resume gives them back, status says so', () => {
  const h = home(PAIRED);
  const paused = jht(h, ['cloud', 'pause', '--json']);
  assert.equal(paused.status, 0, paused.stderr);
  const out = JSON.parse(paused.stdout);
  assert.deepEqual([out.ok, out.paused, out.changed, out.active, out.reason], [true, true, true, false, 'paused']);
  const after = read(h.file);
  assert.equal(after.enabled, false);
  assert.equal(after.paused_by, 'cli');
  assert.match(after.paused_at, /^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
  assert.equal(after.sync_choice, 'user');
  const { enabled: _e, paused_at: _a, paused_by: _b, ...kept } = after;
  const { enabled: _e2, ...before } = PAIRED;
  assert.deepEqual(kept, before);
  assert.equal(mode(h.file), 0o600);

  const status = jht(h, ['cloud', 'status']);
  assert.match(status.stdout, /paused, pairing kept/);
  assert.match(status.stdout, /jht cloud resume/);
  assert.doesNotMatch(status.stdout, /enable --token/);
  noFetch(h, 'pause and status');

  const again = jht(h, ['cloud', 'pause']);
  assert.match(again.stdout, /already paused/);

  const back = jht(h, ['cloud', 'resume', '--json'], { JHT_CLOUD_SYNC: '0' });
  assert.equal(back.status, 0, back.stderr);
  assert.equal(JSON.parse(back.stdout).claim, 'skipped');
  assert.deepEqual(read(h.file), PAIRED);
  assert.equal(mode(h.file), 0o600);
  noFetch(h, 'resume with the variable at 0');
});

test('1b. pause and resume with no pairing say so and change nothing', () => {
  const h = home(null);
  for (const verb of ['pause', 'resume']) {
    const r = jht(h, ['cloud', verb, '--json']);
    assert.equal(r.status, 1);
    assert.deepEqual(JSON.parse(r.stdout), { ok: false, error: 'not-paired' });
  }
  assert.equal(existsSync(h.file), false);
  noFetch(h, 'no pairing');
});

// Each step with what it does on a sync that is ON (so the test knows its trap can fire): `network` reaches fetch
// before anything else; `db` first needs the local database (there is none here), so on it the proof is that it gets
// past the «not enabled» gate and stops at the missing database.
const STEPS = [
  { step: 'claim', on: 'network' }, { step: 'pull-profile', on: 'network' }, { step: 'chat-sync', on: 'network', quiet: true },
  { step: 'preflight', on: 'network' }, { step: 'daemon', on: 'network', long: true },
  { step: 'team-state-listen', on: 'network', long: true }, { step: 'messages-listen', on: 'network', long: true },
  { step: 'file-bridge-listen', on: 'network', long: true },
  { step: 'push', on: 'db' }, { step: 'pull-desired-state', on: 'db' }, { step: 'sync-tickets', on: 'db' },
  { step: 'sync-directives', on: 'db' }, { step: 'realtime-listen', on: 'switch' },
];
const SITE_COMMANDS = { JHT_TEAM_COMMANDS_FROM_SITE: '1' };

test('2. with the sync paused no step of the sync reaches the network', () => {
  const on = home(PAIRED);
  const paused = home(PAIRED);
  assert.equal(jht(paused, ['cloud', 'pause']).status, 0);
  for (const { step, on: how, long, quiet } of STEPS) {
    // control: with the sync on, the step does reach what it should (the trap can fire)
    if (how === 'network' && !long) {
      rmHit(on);
      jht(on, ['cloud', step], SITE_COMMANDS);
      assert.equal(existsSync(on.hit), true, `${step}: the control did not reach the network`);
    }
    if (how === 'db') {
      const c = jht(on, ['cloud', step], SITE_COMMANDS);
      assert.doesNotMatch(`${c.stdout}${c.stderr}`, /not enabled/i, `${step}: the control stopped at the gate`);
    }
    const r = long ? spawnSync(process.execPath, ['--require', paused.trap, JHT, 'cloud', step], {
      encoding: 'utf8', timeout: 20000, env: env(paused, SITE_COMMANDS),
    }) : jht(paused, ['cloud', step], SITE_COMMANDS);
    assert.notEqual(r.status, null, `${step} did not end`);
    noFetch(paused, step);
    if (!quiet) assert.match(`${r.stdout}${r.stderr}`, /not enabled|disabled|skipped/i, `${step} did not say why`);
  }
  assert.equal(read(paused.file).sync_choice, 'user');
});

test('2a. the boot steps of `jht team start` stay silent and succeed on a paused sync', () => {
  const h = home(PAIRED);
  assert.equal(jht(h, ['cloud', 'pause']).status, 0);
  for (const step of ['pull-desired-state', 'sync-tickets', 'sync-directives', 'pull-profile']) {
    const r = jht(h, ['cloud', step, '--silent']);
    assert.equal(r.status, 0, `${step}: ${r.stderr}`);
    assert.equal(r.stdout, '');
  }
  noFetch(h, 'the boot steps');
});

test('2b. the push of the usage samples says «not_paired» for a paused config, without a call', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jht-usage-'));
  const paused = effectiveConfig({ ...PAIRED, enabled: false, paused_at: '2026-11-24T10:00:00.000Z' }, {});
  let called = 0;
  const r = await pushUsageSamples({
    config: paused, samplesPath: join(dir, 'samples.jsonl'), statePath: join(dir, 'state.json'),
    fetchFn: () => { called += 1; throw new Error('fetch called'); },
  });
  assert.equal(r.reason, 'not_paired');
  assert.equal(called, 0);
});

test('3. the variable beats the file; 1 does not turn the sync on without a token', () => {
  assert.equal(syncSwitch(PAIRED, { JHT_CLOUD_SYNC: '0' }).active, false);
  assert.equal(effectiveConfig(PAIRED, { JHT_CLOUD_SYNC: '0' }).enabled, false);
  assert.equal(syncSwitch({ ...PAIRED, enabled: false }, { JHT_CLOUD_SYNC: '1' }).active, true);
  assert.equal(syncSwitch({ enabled: true }, { JHT_CLOUD_SYNC: '1' }).active, false);
  assert.equal(syncSwitch(null, { JHT_CLOUD_SYNC: '1' }).active, false);
  // what the readers see is the answer of the switch, and the file keeps what it said
  const h = home(PAIRED);
  const off = jht(h, ['cloud', 'status'], { JHT_CLOUD_SYNC: '0' });
  assert.match(off.stdout, /off \(JHT_CLOUD_SYNC=0/);
  const off2 = jht(h, ['cloud', 'pull-desired-state'], { JHT_CLOUD_SYNC: '0' });
  assert.notEqual(off2.status, null);
  noFetch(h, 'the variable at 0');
  assert.deepEqual(read(h.file), PAIRED);
});

test('3b. the cases of the switch are the ones the Python twin answers too', () => {
  for (const c of CASES) {
    const e = c.env === null ? {} : { JHT_CLOUD_SYNC: c.env };
    assert.deepEqual(syncSwitch(c.config, e), { active: c.active, reason: c.reason }, c.name);
  }
});

test('4. migration: an enabled file that never chose is paused once; resume ends it; no file creates nothing', () => {
  const legacy = { ...PAIRED };
  delete legacy.sync_choice;
  const h = home(legacy);
  const first = jht(h, ['cloud', 'status']);
  assert.match(first.stderr, /Cloud sync is now paused/);
  assert.match(first.stdout, /paused, pairing kept/);
  const migrated = read(h.file);
  assert.deepEqual([migrated.enabled, migrated.paused_by, migrated.sync_choice], [false, 'release-0.4.0', 'migrated']);
  assert.equal(mode(h.file), 0o600);
  // the notice comes once
  const second = jht(h, ['cloud', 'status']);
  assert.doesNotMatch(second.stderr, /now paused/);
  assert.deepEqual(read(h.file), migrated);
  // resume is the choice: it does not come back
  assert.equal(jht(h, ['cloud', 'resume'], { JHT_CLOUD_SYNC: '0' }).status, 0);
  assert.equal(read(h.file).sync_choice, 'user');
  assert.equal(read(h.file).enabled, true);
  assert.equal(migrateSyncChoice(h.file).migrated, false);
  assert.equal(jht(h, ['cloud', 'status'], { JHT_CLOUD_SYNC: '0' }).stderr.includes('now paused'), false);
  assert.equal(read(h.file).enabled, true);
  // no file: nothing is created, by the command or by the function
  const none = home(null);
  jht(none, ['cloud', 'status']);
  assert.equal(existsSync(none.file), false);
  assert.equal(migrateSyncChoice(none.file).migrated, false);
  assert.equal(existsSync(none.file), false);
  // a file that already chose, on or off, is left alone
  for (const choice of ['user', 'migrated']) {
    const g = home({ ...PAIRED, sync_choice: choice });
    assert.equal(migrateSyncChoice(g.file).migrated, false);
  }
  noFetch(h, 'the migration');
});

test('4b. a pairing made by enable, login or the installer chose: the migration leaves it alone', () => {
  const src = readFileSync(resolve(import.meta.dirname, '../src/commands/cloud.js'), 'utf8');
  assert.equal((src.match(/sync_choice: 'user',/g) ?? []).length, 3); // enable, login, pair
  assert.match(src, /paused_by: 'installer'/);
});

test('5. what pid1 asks changes with the file: on, paused, on again, and the variable', async () => {
  const h = home(PAIRED);
  const asks = (e = {}) => isCloudConfigured(h.file, e);
  // on; paused (the watcher sees it and stops the daemon and the pollers); on again (it starts them); the variable at 0
  assert.equal(await asks(), true);
  assert.equal(pauseCloud(h.file).ok, true);
  assert.equal(await asks(), false);
  assert.equal(resumeCloud(h.file).ok, true);
  assert.equal(await asks(), true);
  assert.equal(await asks({ JHT_CLOUD_SYNC: '0' }), false);
  assert.equal(await isCloudConfigured(join(h.dir, 'missing.json'), {}), false);
  const src = readFileSync(resolve(import.meta.dirname, '../src/commands/pid1.js'), 'utf8');
  assert.match(src, /stopDaemon\('cloud\.json removed or disabled'\)/);
  assert.match(src, /migrateSyncChoice\(CLOUD_JSON_PATH\)/);
});

test('resume asks for the claim without force and tells when another device holds it', async () => {
  const requests = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      requests.push({ url: req.url, body: JSON.parse(body || '{}') });
      res.writeHead(409, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'device_already_claimed', current_device_id: 'abcdefabcdefabcdef' }));
    });
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  try {
    const h = home({ ...PAIRED, base_url: `http://127.0.0.1:${server.address().port}` });
    assert.equal(pauseCloud(h.file).ok, true);
    const r = await new Promise((done) => {
      const child = spawn(process.execPath, [JHT, 'cloud', 'resume'], { env: env(h) });
      let out = '';
      child.stdout.on('data', (d) => { out += d; });
      child.on('close', (code) => done({ code, out }));
    });
    assert.equal(r.code, 0);
    assert.match(r.out, /Another device holds the team claim \(abcdefabcdef\)/);
    assert.match(r.out, /jht cloud claim --force/);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/api/team-state/claim');
    assert.equal(requests[0].body.force, false);
    assert.equal(read(h.file).enabled, true);
  } finally {
    server.close();
  }
});

test('the help of disable says it deletes the pairing and points to pause', () => {
  const h = home(null);
  const r = jht(h, ['cloud', 'disable', '--help']);
  assert.match(r.stdout, /Delete the pairing/);
  assert.match(r.stdout, /use pause/);
});

async function pairAgainstLocalServer(markerPresent) {
  const paths = [];
  const server = createServer((req, res) => {
    paths.push(req.url);
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ token: TOKEN, user_id: PAIRED.user_id, token_name: 'invented-device' }));
    });
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  try {
    const h = home(null);
    const payload = { user_id: PAIRED.user_id, refresh_token: 'invented-refresh', supabase_url: 'http://127.0.0.1:9' };
    writeFileSync(join(h.dir, '.pairing-token'), Buffer.from(JSON.stringify(payload)).toString('base64'), { mode: 0o600 });
    if (markerPresent) writeFileSync(join(h.dir, '.pairing-paused'), '', { mode: 0o600 });
    const url = `http://127.0.0.1:${server.address().port}`;
    const r = await new Promise((done) => {
      const child = spawn(process.execPath, [JHT, 'cloud', 'pair', '--url', url], { env: env(h) });
      let out = '';
      child.stdout.on('data', (d) => { out += d; });
      child.on('close', (code) => done({ code, out }));
    });
    return { h, r, paths };
  } finally {
    server.close();
  }
}

test('6. a pairing from the installer without --cloud-sync on starts paused, with the pairing kept (O1)', async () => {
  const { h, r, paths } = await pairAgainstLocalServer(true);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(paths, ['/api/cloud-sync/device-register']); // no claim question while paused
  const cfg = read(h.file);
  assert.deepEqual([cfg.enabled, cfg.paused_by, cfg.sync_choice, cfg.token], [false, 'installer', 'user', TOKEN]);
  assert.equal(syncSwitch(cfg, {}).reason, 'paused');
  assert.equal(mode(h.file), 0o600);
  assert.equal(existsSync(join(h.dir, '.pairing-paused')), false);
  assert.equal(existsSync(join(h.dir, '.pairing-token')), false);
  assert.match(r.out, /jht cloud resume/);
  // and the migration leaves it alone
  assert.equal(migrateSyncChoice(h.file).migrated, false);
});

test('6b. without the marker (--cloud-sync on) the pairing starts on, as before', async () => {
  const { h, r } = await pairAgainstLocalServer(false);
  assert.equal(r.code, 0, r.out);
  const cfg = read(h.file);
  assert.deepEqual([cfg.enabled, cfg.sync_choice, 'paused_at' in cfg], [true, 'user', false]);
});
