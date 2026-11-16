// A role that cannot start is said by jht team status and jht doctor, not only retried in the watchdog's log (giro Windows build6:
// Dottore and Mantenitore never started, 26 failures in an hour). The watchdog writes logs/spawn-failed.json; synthetic files here.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

process.env.JHT_LANG = 'en';
// the home of jht team status below: JHT_HOME is read when the modules are loaded
const STATUS_HOME = mkdtempSync(join(tmpdir(), 'jht-spawn-failed-status-'));
process.env.JHT_HOME = STATUS_HOME;
const { spawnFailures, spawnFailureTexts } = await import('../src/lib/spawn-failed.js');
const { show } = await import('../src/lib/texts.js');
const { handleAgents } = await import('../src/commands/agents.js');
const JHT = fileURLToPath(new URL('../bin/jht.js', import.meta.url));

const ERROR = '[spawn-lib] ERROR: pi needs /jht_home/agents/dottore/AGENTS.md and /jht_home/agents/dottore/.agents/skills before it starts; one is missing.';
function home(content) {
  const root = mkdtempSync(join(tmpdir(), 'jht-spawn-failed-'));
  mkdirSync(join(root, 'logs'));
  if (content !== undefined) writeFileSync(join(root, 'logs', 'spawn-failed.json'), typeof content === 'string' ? content : JSON.stringify(content));
  return root;
}
const NOW = new Date('2026-11-16T19:50:00Z');

test('each role that cannot start, with the time of the last try and the line of the error', () => {
  const root = home({ dottore: { at: '2026-11-16T20:49:00+01:00', rc: 1, why: ERROR }, mantenitore: { at: '2026-11-16T20:44:00+01:00', rc: 1, why: '' } });
  const texts = spawnFailureTexts({ home: root, now: NOW }).map((t) => show(t, 'en'));
  assert.deepEqual(texts, [
    `DOTTORE cannot start (last try 20:49, tried again every 5 minutes): ${ERROR}`,
    'MANTENITORE cannot start (last try 20:44, tried again every 5 minutes): see logs/doctor-watchdog-loop.log',
  ]);
  assert.match(show(spawnFailureTexts({ home: root, now: NOW })[0], 'it'), /^DOTTORE non riesce a partire \(ultimo tentativo 20:49, si riprova ogni 5 minuti\): /);
});

test('nothing to say without the file, with a broken one, or with roles it does not know; control characters never pass', () => {
  assert.deepEqual(spawnFailures({ home: home() }), []);
  assert.deepEqual(spawnFailures({ home: home('{not json') }), []);
  assert.deepEqual(spawnFailures({ home: home([1, 2]) }), []);
  assert.deepEqual(spawnFailures({ home: home({ capitano: { at: 'x', why: 'y' } }) }), []);
  const [only] = spawnFailures({ home: home({ dottore: { at: 'nonsense', why: `\x1b[31mred\x07 ${'x'.repeat(400)}` } }), now: NOW });
  assert.equal(only.at, null);
  assert.ok(!/[\x00-\x1f]/.test(only.why) && only.why.length <= 240 && only.why.startsWith('[31mred'));
});

test('jht team status says it under the agents', () => {
  mkdirSync(join(STATUS_HOME, 'logs'), { recursive: true });
  writeFileSync(join(STATUS_HOME, 'logs', 'spawn-failed.json'), JSON.stringify({ dottore: { at: '2026-11-16T20:49:00+01:00', rc: 1, why: ERROR } }));
  const lines = [];
  const log = console.log;
  const write = process.stdout.write;
  console.log = (line) => lines.push(String(line));
  process.stdout.write = () => true;
  try {
    // the snapshot of the observer is not what this test is about: an empty team
    handleAgents({}, () => ({ ok: true, at: 0, running: 0, total: 0, usage: {}, sampling: {}, errors: [], agents: [] }));
  } finally {
    console.log = log;
    process.stdout.write = write;
  }
  assert.ok(lines.some((line) => line.startsWith('⚠ DOTTORE cannot start')), lines.join('\n'));
});

test('jht doctor counts it as a problem, with the way to the details', () => {
  const run = (root) => spawnSync(process.execPath, [JHT, 'doctor'], { encoding: 'utf8', timeout: 60_000,
    env: { ...process.env, JHT_HOME: root, JHT_LANG: 'en', NO_COLOR: '1' } });
  const failing = run(home({ mantenitore: { at: '2026-11-16T20:44:00+01:00', rc: 1, why: ERROR.replace(/dottore/g, 'mantenitore') } }));
  assert.match(failing.stdout, /MANTENITORE cannot start/);
  assert.match(failing.stdout, /doctor-watchdog-loop\.log/);
  assert.equal(failing.status, 1);
  assert.doesNotMatch(run(home()).stdout, /cannot start/);
});
