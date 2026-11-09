// The pauses of `jht team start` between the agents are checks with a ceiling, not fixed seconds: an item waits for the one
// before it to be READY (a CLI on screen, a state file) and never longer than the old pause; an item whose predecessor did not
// start (deferred, already active) waits for nothing.
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildContainerBootstrap, waitForReady } from '../src/commands/team/start.js';

// a clock that only the fake wait moves, and a probe that answers from a script
function harness(answers) {
  let clock = 0;
  const calls = [];
  return {
    calls,
    run: (argv) => { calls.push(argv); return { code: answers.length ? answers.shift() : 1 }; },
    wait: async (ms) => { clock += ms; },
    now: () => clock,
  };
}

test('ready when the probe passes twice in a row: a second, not the whole pause', async () => {
  const h = harness([0, 0]);
  const done = await waitForReady({ probe: ['probe'], ceilingMs: 20000, ...h });
  assert.deepEqual(done, { ready: true, waitedMs: 1000 });
  assert.equal(h.calls.length, 2);
});

test('a probe that fails in between starts the count again', async () => {
  const h = harness([0, 1, 0, 0]);
  const done = await waitForReady({ probe: ['probe'], ceilingMs: 20000, ...h });
  assert.deepEqual(done, { ready: true, waitedMs: 3000 });
});

test('never longer than the ceiling: it gives up and the start goes on', async () => {
  const h = harness([]);
  const done = await waitForReady({ probe: ['probe'], ceilingMs: 5000, ...h });
  assert.equal(done.ready, false);
  assert.ok(done.waitedMs <= 5000, `waited ${done.waitedMs} ms`);
});

test('a probe that cannot run (no answer) counts as not ready, never as an error', async () => {
  let clock = 0;
  const done = await waitForReady({ probe: ['p'], ceilingMs: 3000, run: () => undefined, wait: async (ms) => { clock += ms; }, now: () => clock });
  assert.equal(done.ready, false);
});

test('the probe runs the way the container runs commands: argv, with a time limit', async () => {
  const seen = [];
  await waitForReady({ probe: ['a', 'b'], ceilingMs: 2000, run: (argv, options) => { seen.push([argv, options]); return { code: 0 }; }, wait: async () => {}, now: () => 0 });
  assert.deepEqual(seen[0][0], ['a', 'b']);
  assert.ok(seen[0][1].timeoutMs > 0);
});

test('every item the next one depends on says how to see it ready; the old ceilings are kept', () => {
  const byRole = Object.fromEntries(buildContainerBootstrap(true).map((item) => [item.role, item]));
  for (const role of ['assistente', 'sentinella', 'bridge', 'token-meter', 'mentor']) {
    assert.ok(Array.isArray(byRole[role].ready) && byRole[role].ready.length > 0, `${role} has a probe`);
  }
  assert.equal(byRole['tg-bridge'].ready, undefined);
  assert.deepEqual([byRole['tg-bridge'], byRole.sentinella, byRole.bridge, byRole['token-meter'], byRole.mentor, byRole.capitano].map((item) => item.preDelayMs),
    [5000, 3000, 20000, 5000, 3000, 5000]);
  // the CLI probes ask about their own session, the daemon probes about their own state file
  assert.equal(byRole.sentinella.ready.at(-1), 'SENTINELLA');
  assert.equal(byRole.bridge.ready.at(-1), 'sentinel-bridge-state.json');
});
