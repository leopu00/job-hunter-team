import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { readObservation, validObservation } from '../src/lib/agent-observation.js';
import { bar, renderObservation } from '../src/lib/agent-observation-view.js';
import { monitor } from '../src/commands/monitor.js';

function snapshot() {
  return { ok: true, at: 1, running: 1, total: 2, errors: [],
    usage: { window: '1h', unit: 'weighted_tokens', generated_at: '2026-01-01T00:00:00Z', age_seconds: 30 },
    agents: [{ id: 'capitano', session: 'CAPITANO', running: true, state: 'idle',
      identity: { model: 'gpt-5.6-luna', effort: 'low' },
      usage: { tokens: 3500, reason: null },
      process: { pids: [123], alive: true, cpu_pct: 25, rss_bytes: 1048576, rss_pct: 10 } },
    { id: 'scout-4', session: 'SCOUT-4', running: false, state: 'spento', identity: null,
      usage: { tokens: null, reason: 'observer_usage_unattributed' }, process: null }] };
}

test('the real renderer shows actual model, each instance, measured zero vs N/D and limits', () => {
  const data = snapshot();
  data.agents.push({ ...data.agents[1], id: 'dottore', session: 'DOTTORE', usage: { tokens: 0 } });
  const text = renderObservation(data, { live: true, width: 100 });
  assert.match(text, /luna \/ low/);
  assert.match(text, /scout-4/);
  assert.match(text, /dottore/);
  assert.match(text, /3500/);
  assert.match(text, /Agent {2,}Session/);
  assert.match(text, /capitano {2,}CAPITANO/);
  assert.match(text, /N\/D/);
  assert.match(text, /PID 123/);
  assert.match(text, /25% \[###/);
  assert.match(text, /weighted|Weighted/);
  assert.match(text, /rolling 1h/);
  assert.match(text, /not proof of work/);
  assert.match(text, /Short-lived processes, VM/);
  assert.doesNotMatch(text, /\x1b\[/);
  assert.equal(bar(null), 'N/D');
  assert.equal(bar(0), '[..........]');
  assert.equal(bar(100), '[##########]');
});

test('transport uses a fixed argv, rejects failures and malformed answers', () => {
  const data = snapshot();
  const actual = readObservation((command, args, options) => {
    assert.equal(command, 'python3');
    assert.equal(args.length, 1);
    assert.match(args[0], /shared\/skills\/agent_observer\.py$/);
    assert.equal(options.timeout, 20000);
    return { status: 0, stdout: JSON.stringify(data) };
  });
  assert.deepEqual(actual, data);
  assert.throws(() => readObservation(() => ({ status: 2 })), /observer_read_failed/);
  assert.throws(() => readObservation(() => ({ status: 0, stdout: '{}' })), /observer_read_invalid/);
  assert.throws(() => readObservation(() => ({ status: 0, stdout: '{' })), /observer_read_invalid/);
  assert.equal(validObservation({ ...data, usage: {} }), false);
  assert.equal(validObservation({ ...data, agents: [{ ...data.agents[0], usage: { tokens: -1 } }] }), false);
});

test('the real observer reads a fake home and fake tmux, without a running team', () => {
  const home = mkdtempSync(join(tmpdir(), 'jht-observer-'));
  try {
    const bin = join(home, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'tmux'), '#!/bin/sh\nprintf "CAPITANO\\t1\\t12345\\t0\\nDOTTORE\\t1\\t12346\\t0\\n"\n');
    chmodSync(join(bin, 'tmux'), 0o755);
    const data = readObservation((command, args, options) => {
      const result = spawnSync(command, args, { ...options,
        env: { HOME: home, JHT_HOME: home, PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin` } });
      assert.ok([0, 1].includes(result.status), result.stderr);
      return result;
    });
    assert.equal(data.running, 2);
    assert.deepEqual(data.agents.map((row) => row.id), ['capitano', 'dottore']);
  } finally { rmSync(home, { recursive: true }); }
});

test('a pipe gets an explicit refusal, --once and --json use the very same sample', async () => {
  let text = '';
  const output = { isTTY: false, write: (value) => { text += value; } };
  await assert.rejects(monitor({}, { output }), /observer_terminal_required/);
  assert.equal(await monitor({ json: true }, { output, read: snapshot }), 0);
  assert.deepEqual(JSON.parse(text), snapshot());
  text = '';
  assert.equal(await monitor({ once: true }, { output, read: snapshot }), 0);
  assert.match(text, /Agent monitor/);
  assert.doesNotMatch(text, /\x1b\[/);
});

function fakeReader(reply) {
  // A real, owned child. EOF on its input closes it; no team process exists.
  const code = `const readline=require('node:readline');
    const reply=JSON.parse(process.argv[1]);
    readline.createInterface({input:process.stdin}).on('line',()=>{
      process.stdout.write(typeof reply==='string'?reply+'\\n':JSON.stringify(reply)+'\\n');
    });`;
  return spawn(process.execPath, ['-e', code, JSON.stringify(reply)], { stdio: ['pipe', 'pipe', 'pipe'] });
}

test('live stream refreshes by request; Ctrl-C closes only its child and removes listeners', async () => {
  const signals = new EventEmitter();
  let child, text = '', writes = 0;
  const output = { isTTY: true, write: (value) => {
    text += value;
    if (++writes === 2) signals.emit('SIGINT');
  } };
  assert.equal(await monitor({}, { output, signals, intervalMs: 2,
    open: () => { child = fakeReader(snapshot()); return child; } }), 0);
  assert.equal(writes, 2);
  assert.match(text, /\x1b\[H\x1b\[2J/);
  assert.equal(child.exitCode, 0);
  assert.equal(signals.listenerCount('SIGINT'), 0);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
});

test('a bad stream reply actually fails the monitor and its owned child exits', async () => {
  const signals = new EventEmitter();
  let child;
  await assert.rejects(monitor({}, { output: { isTTY: true, write() {} }, signals,
    open: () => { child = fakeReader('not JSON'); return child; } }), /observer_read_invalid/);
  assert.equal(child.exitCode, 0);
  assert.equal(signals.listenerCount('SIGINT'), 0);
});

for (const [label, corrupt] of [
  ['null row', (data) => { data.agents = [null]; data.total = 1; data.running = 0; }],
  ['malformed pids', (data) => { data.agents[0].process.pids = {}; }],
]) test(`${label} fails inside the monitor and cleans up its child`, async () => {
  const signals = new EventEmitter();
  const data = snapshot();
  corrupt(data);
  assert.equal(validObservation(data), false);
  let child;
  await assert.rejects(monitor({}, { output: { isTTY: true, write() {} }, signals,
    open: () => { child = fakeReader(data); return child; } }), /observer_read_invalid/);
  assert.equal(child.exitCode, 0);
  assert.equal(signals.listenerCount('SIGINT'), 0);
});

test('control characters from data are not passed to the display', () => {
  const data = snapshot();
  data.agents[0].identity.model = 'bad\x1b[2J';
  data.agents[0].id = 'capitano\r\nINJECTED';
  assert.doesNotMatch(renderObservation(data, { width: 80 }), /\x1b|\r|capitano\n/);
});
