// JHT-T354: the Assistente reads the state of the team from `jht team status --json`, never from the open sessions (they stay
// open in a pause). The JSON carries the pause and where the team runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

process.env.JHT_HOME = mkdtempSync(join(tmpdir(), 'jht-team-status-json-'));
const { handleAgents } = await import('../src/commands/agents.js');
const { hostType, hostOs, hostWhere, mountFsType } = await import('../src/lib/host-where.js');

const FOLDERS = (os) => ({ allegati: { name: 'Anlagen', path: `~/Documents/Job Hunter Team/Anlagen (${os})` } });
const EMPTY = () => ({ ok: true, at: 0, running: 3, total: 3, usage: {}, sampling: {}, errors: [], agents: [] });
function jsonOf(pause, spend = null) {
  const lines = [];
  const log = console.log;
  console.log = (line) => lines.push(String(line));
  try { handleAgents({ json: true }, EMPTY, { pauseOf: () => pause, spendOf: () => spend, whereOf: () => ({ host_type: 'vps', host_os: 'linux' }), foldersOf: FOLDERS }); }
  finally { console.log = log; }
  return JSON.parse(lines.join('\n'));
}

test('a team paused by the budget says it in the JSON, with the sessions still open', () => {
  const pause = { kind: 'budget', why: 'budget', spent: 2.87, ceiling: 3, budgetUsd: 3, endsAt: null, resumesAt: null };
  const seen = jsonOf(pause);
  assert.equal(seen.running, 3);
  assert.deepEqual(seen.pause, pause);
  assert.deepEqual(seen.where, { host_type: 'vps', host_os: 'linux', folders: FOLDERS('linux') });
});

test('a team at work has pause null, never a missing field', () => {
  const seen = jsonOf(undefined);
  assert.ok(Object.hasOwn(seen, 'pause'));
  assert.equal(seen.pause, null);
  assert.equal(seen.spend_now, null);
});

test('the spending of now is in the JSON as data, the same in every language, from the last look of the brake', async () => {
  const { spendNow, spendNowText } = await import('../src/lib/budget-pause.js');
  const { show } = await import('../src/lib/texts.js');
  const root = mkdtempSync(join(tmpdir(), 'jht-spend-now-'));
  mkdirSync(join(root, 'state'));
  const now = new Date('2026-11-27T12:40:00Z');
  writeFileSync(join(root, 'state', 'spend-now.json'), JSON.stringify({ at: now.getTime() / 1000 - 60, spent_usd: 2.87, usd_per_min: 0.01, window_min: 10, counts: 'budget', budget_usd: 3 }));
  const data = spendNow({ home: root, now });
  assert.deepEqual(data, { at: '2026-11-27T12:39:00.000Z', spentUsd: 2.87, usdPerMin: 0.01, windowMin: 10, budgetUsd: 3 });
  assert.deepEqual(jsonOf(null, data).spend_now, data);
  // the text of `jht team status` is built from the same data
  assert.match(show(spendNowText({ home: root, now }), 'en'), /2\.87.*3\.00/);
  assert.equal(spendNow({ home: root, now: new Date('2026-11-29T12:40:00Z') }), null, 'a day old says nothing');
});

const MOUNT = (fs) => [
  '600 500 0:50 / /jht_home rw,relatime - ext4 /dev/vda1 rw',
  `601 500 0:51 /someone/Documents/Job\\040Hunter\\040Team /jht_user rw,relatime - ${fs} share rw`,
].join('\n');
const reading = (files) => (path) => { if (path in files) return files[path]; throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); };

test('the kind of host: the environment, else host.env, else local', () => {
  assert.equal(hostType({ env: { JHT_HOST_TYPE: 'VPS' }, read: reading({}) }), 'vps');
  assert.equal(hostType({ env: {}, home: '/h', read: reading({ '/h/host.env': 'JHT_LANG=it\nJHT_HOST_TYPE=vps\n' }) }), 'vps');
  assert.equal(hostType({ env: {}, home: '/h', read: reading({ '/h/host.env': 'JHT_HOST_TYPE=local\n' }) }), 'local');
  assert.equal(hostType({ env: {}, home: '/h', read: reading({}) }), 'local');
});

test('the system of the host: a VPS is Linux; in the container the share of the folder of the person tells it', () => {
  assert.equal(hostOs({ type: 'vps', platform: 'darwin' }), 'linux');
  assert.equal(hostOs({ type: 'local', platform: 'linux', read: reading({ '/proc/self/mountinfo': MOUNT('virtiofs') }) }), 'macos');
  assert.equal(hostOs({ type: 'local', platform: 'linux', read: reading({ '/proc/self/mountinfo': MOUNT('9p') }) }), 'windows');
  assert.equal(hostOs({ type: 'local', platform: 'linux', read: reading({ '/proc/self/mountinfo': MOUNT('ext4') }) }), 'linux');
  // outside the container: the system Node runs on
  assert.equal(hostOs({ type: 'local', platform: 'darwin', read: reading({}) }), 'macos');
  assert.equal(hostOs({ type: 'local', platform: 'win32', read: reading({}) }), 'windows');
  // a container without the folder of the person cannot tell: null, never a guess
  assert.equal(hostOs({ type: 'local', platform: 'linux', read: reading({ '/proc/self/mountinfo': MOUNT('ext4').split('\n')[0] }) }), null);
  assert.equal(mountFsType('garbage'), null);
});

test('hostWhere puts the two together', () => {
  assert.deepEqual(hostWhere({ env: { JHT_HOST_TYPE: 'vps' } }), { host_type: 'vps', host_os: 'linux' });
});
