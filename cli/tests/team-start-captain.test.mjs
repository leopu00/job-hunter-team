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
