// The Capitano is not started while the onboarding with the Assistente is open: `captain_gate.py` says 1 (not yet)
// and `jht team start` leaves it for the watchdog, which starts it once the onboarding closes. Any other answer is
// «start it», as it always was.
import assert from 'node:assert/strict';
import test from 'node:test';
import { captainDeferred } from '../src/commands/team/start.js';

const answers = (code) => (argv, options) => {
  answers.seen = { argv, options };
  return { ok: code === 0, stdout: '', stderr: '', code };
};

test('exit 1 from captain_gate defers the Capitano', () => {
  assert.equal(captainDeferred(answers(1)), true);
  assert.deepEqual(answers.seen.argv, ['python3', '/app/shared/skills/captain_gate.py']);
});

test('exit 0 means it is time', () => {
  assert.equal(captainDeferred(answers(0)), false);
});

for (const code of [2, 127, 124, -1, null, undefined]) {
  test(`anything but a clear no (${code}) starts the Capitano`, () => {
    assert.equal(captainDeferred(answers(code)), false);
  });
}

test('a runner that gives nothing back starts the Capitano', () => {
  assert.equal(captainDeferred(() => undefined), false);
});

test('the reason of the wait is kept, so a closed onboarding that waits for the tools is not told to answer questions', async () => {
  const { captainDeferred: ask } = await import('../src/commands/team/start.js');
  assert.equal(ask(() => ({ ok: false, stdout: '{"captain_due": false, "reason": "tools_pending"}\n', stderr: '', code: 1 })), true);
  assert.equal(ask(() => ({ ok: false, stdout: 'not json', stderr: '', code: 1 })), true);
});

test('a failed download of the tools is said with the command to give, not as a wait of a few minutes (JHT-T362)', async () => {
  const { captainDeferred: ask, captainWaiting } = await import('../src/commands/team/start.js');
  assert.equal(ask(() => ({ ok: false, stdout: '{"captain_due": false, "reason": "tools_failed"}\n', stderr: '', code: 1 })), true);
  assert.match(captainWaiting(), /jht tools pull/);
  ask(() => ({ ok: false, stdout: '{"captain_due": false, "reason": "tools_pending"}\n', stderr: '', code: 1 }));
  assert.doesNotMatch(captainWaiting(), /jht tools pull/);
});

test('after an update, a Capitano or a Sentinella that start-agent.sh holds (exit 75) is a wait, not a failed agent', async () => {
  const { heldByCaptainGate } = await import('../src/commands/team/start.js');
  assert.equal(heldByCaptainGate('sentinella', 75), true);
  assert.equal(heldByCaptainGate('capitano', 75), true);
  // another role held for its own reason, or the gate's roles failing otherwise, stay what they are
  assert.equal(heldByCaptainGate('scout', 75), false);
  assert.equal(heldByCaptainGate('sentinella', 1), false);
  assert.equal(heldByCaptainGate('sentinella', 0), false);
});

test('a held Capitano or Sentinella is counted as deferred and said with the gate\'s words, never as an error', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/commands/team/start.js', import.meta.url), 'utf8');
  const launch = source.slice(source.indexOf('function launchInContainer'), source.indexOf('// Cosa deve esserci perche'));
  const held = launch.indexOf('heldByCaptainGate(role, r.code)');
  assert.ok(held > 0 && held < launch.indexOf("c.red('✗')"), 'the wait is answered before the error line');
  assert.match(launch, /captainWaiting\(\)[\s\S]*return 'deferred'/);
  assert.equal((source.match(/else if \(result === 'deferred'\)/g) || []).length, 2, 'both callers count it as deferred');
});
