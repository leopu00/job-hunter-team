// The secrets broker's link to the website follows the switch of the sync.
// A fake broker (a unix socket that answers like shared/broker/server.py) stands for the real one. Synthetic data only, offline.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { brokerPresent, brokerSocketPath, pauseBrokerWebSync } from '../src/lib/broker-web-sync.js';
import { brokerSyncMode, migrationPending } from '../src/lib/cloud-sync-pause.js';

const JHT = resolve(import.meta.dirname, '../bin/jht.js');
const PAIRED = Object.freeze({
  enabled: true, base_url: 'http://127.0.0.1:9', token: 'jht_sync_invented_token_for_the_tests_0000',
  user_id: '00000000-0000-4000-8000-000000000001', token_name: 'invented', enabled_at: '2026-11-01T10:00:00.000Z',
  sync_choice: 'user',
});

/** A broker that records the lines it gets and answers with `answer` (or never, when `answer` is null). */
async function fakeBroker(answer = { ok: true, sync: 'off' }) {
  const dir = mkdtempSync(join(tmpdir(), 'jht-fake-broker-'));
  const requests = [];
  const server = net.createServer((conn) => {
    let data = '';
    conn.on('data', (chunk) => {
      data += chunk;
      if (!data.includes('\n')) return;
      requests.push(JSON.parse(data.split('\n', 1)[0]));
      if (answer) conn.end(`${JSON.stringify(answer)}\n`);
    });
    conn.on('error', () => {});
  });
  await new Promise((ok) => server.listen(join(dir, 'broker.sock'), ok));
  return { dir, requests, env: { JHT_BROKER_SOCKET_DIR: dir }, close: () => new Promise((ok) => { server.closeAllConnections?.(); server.close(ok); }) };
}

function home(config) {
  const dir = mkdtempSync(join(tmpdir(), 'jht-broker-sync-'));
  const file = join(dir, 'cloud.json');
  if (config) writeFileSync(file, JSON.stringify(config, null, 2), { mode: 0o600 });
  return { dir, file };
}

function jht(h, args, extra = {}) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [JHT, ...args], {
      env: { ...process.env, JHT_HOME: h.dir, HOME: h.dir, NO_COLOR: '1', JHT_LANG: 'en', JHT_CLOUD_SYNC: '', JHT_BROKER_SOCKET_DIR: join(h.dir, 'no-broker'), ...extra },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => done({ code, stdout, stderr }));
  });
}

test('the client: no socket is no broker, a broker that answers ok is paused, one that refuses or is silent is unreachable', async () => {
  const none = mkdtempSync(join(tmpdir(), 'jht-no-broker-'));
  assert.equal(brokerPresent({ env: { JHT_BROKER_SOCKET_DIR: none } }), false);
  assert.deepEqual(await pauseBrokerWebSync({ env: { JHT_BROKER_SOCKET_DIR: none } }), { state: 'no-broker' });

  const ok = await fakeBroker();
  try {
    assert.equal(brokerPresent({ env: ok.env }), true);
    assert.equal(brokerSocketPath(ok.env), join(ok.dir, 'broker.sock'));
    assert.deepEqual(await pauseBrokerWebSync({ env: ok.env }), { state: 'paused' });
    assert.deepEqual(ok.requests, [{ op: 'web.pause', args: {}, role: 'cli' }]);
  } finally { await ok.close(); }

  const refuses = await fakeBroker({ ok: false, reason: 'peer_not_allowed' });
  try {
    assert.deepEqual(await pauseBrokerWebSync({ env: refuses.env }), { state: 'unreachable', reason: 'peer_not_allowed' });
  } finally { await refuses.close(); }

  const silent = await fakeBroker(null);
  try {
    assert.deepEqual(await pauseBrokerWebSync({ env: silent.env, timeoutMs: 150 }), { state: 'unreachable', reason: 'timeout' });
  } finally { await silent.close(); }
});

test('jht cloud pause tells a running broker, also when the file was already paused, and says so when it cannot', async () => {
  const broker = await fakeBroker();
  try {
    const h = home(PAIRED);
    const first = await jht(h, ['cloud', 'pause', '--json'], broker.env);
    assert.equal(first.code, 0, first.stderr);
    assert.equal(JSON.parse(first.stdout).broker, 'paused');
    const again = await jht(h, ['cloud', 'pause'], broker.env);
    assert.match(again.stdout, /already paused/);
    assert.equal(broker.requests.length, 2);
    assert.ok(broker.requests.every((r) => r.op === 'web.pause'));
  } finally { await broker.close(); }

  const refusing = await fakeBroker({ ok: false, reason: 'peer_not_allowed' });
  try {
    const h = home(PAIRED);
    const r = await jht(h, ['cloud', 'pause'], refusing.env);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /Cloud sync paused/);
    assert.match(r.stdout, /secrets broker could not be told now \(peer_not_allowed\); it stops asking the site at the next jht up/);
    assert.equal(JSON.parse(readFileSync(h.file, 'utf8')).enabled, false); // the pause itself stands
  } finally { await refusing.close(); }
});

test('without a broker the output of pause and resume is what it was', async () => {
  const h = home(PAIRED);
  const paused = await jht(h, ['cloud', 'pause', '--json']);
  assert.equal('broker' in JSON.parse(paused.stdout), false);
  const text = await jht(h, ['cloud', 'resume']);
  assert.doesNotMatch(text.stdout, /secrets broker/);
});

test('jht cloud resume inside the box never asks the broker to turn on: it can only say who does', async () => {
  const broker = await fakeBroker();
  try {
    const h = home({ ...PAIRED, enabled: false, paused_at: '2026-11-24T10:00:00.000Z', paused_by: 'cli' });
    const r = await jht(h, ['cloud', 'resume'], broker.env);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /The secrets broker takes the change from the host/);
    assert.deepEqual(broker.requests, []);
    const json = await jht(h, ['cloud', 'resume', '--json'], broker.env);
    assert.equal(JSON.parse(json.stdout).broker, 'follows-host');
    assert.deepEqual(broker.requests, []);
  } finally { await broker.close(); }
});

test('jht cloud disable stops the broker too', async () => {
  const broker = await fakeBroker();
  try {
    const h = home(PAIRED);
    const r = await jht(h, ['cloud', 'disable', '--local-only'], broker.env);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(broker.requests.map((q) => q.op), ['web.pause']);
  } finally { await broker.close(); }
});

test('the word the host gives the broker: the switch of the sync, with a pairing the migration is about to pause answered as paused', () => {
  const paused = { ...PAIRED, enabled: false, paused_at: '2026-11-24T10:00:00.000Z' };
  assert.equal(brokerSyncMode(PAIRED, {}), 'on');
  assert.equal(brokerSyncMode(paused, {}), 'off');
  assert.equal(brokerSyncMode({ ...paused, sync_choice: 'migrated' }, {}), 'off');
  assert.equal(brokerSyncMode(null, {}), 'off');
  assert.equal(brokerSyncMode([], {}), 'off');
  // never went through the choice: the migration pauses it in the container a moment after it starts
  const { sync_choice: _c, ...unchosen } = PAIRED;
  assert.equal(migrationPending(unchosen), true);
  assert.equal(migrationPending(PAIRED), false);
  assert.equal(brokerSyncMode(unchosen, {}), 'off');
  // the variable decides as it does everywhere else
  assert.equal(brokerSyncMode(unchosen, { JHT_CLOUD_SYNC: '1' }), 'on');
  assert.equal(brokerSyncMode(PAIRED, { JHT_CLOUD_SYNC: '0' }), 'off');
  assert.equal(brokerSyncMode(paused, { JHT_CLOUD_SYNC: '1' }), 'on');
});
