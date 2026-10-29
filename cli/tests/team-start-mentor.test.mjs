// The Mentor is not started at the boot of a team whose first run is still open: `first_run.py mentor-due` says 1
// (not yet) and `jht team start` leaves it for the watchdog, which starts it once the run is steady. Any other
// answer is «start it», as it always was.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mentorDeferred } from '../src/commands/team/start.js';

const answers = (code) => (argv, options) => {
  answers.seen = { argv, options };
  return { ok: code === 0, stdout: '', stderr: '', code };
};

test('exit 1 from mentor-due defers the Mentor', () => {
  assert.equal(mentorDeferred(answers(1)), true);
  assert.deepEqual(answers.seen.argv, ['python3', '/app/shared/skills/first_run.py', 'mentor-due']);
});

test('exit 0 means it is time', () => {
  assert.equal(mentorDeferred(answers(0)), false);
});

for (const code of [2, 127, 124, -1, null, undefined]) {
  test(`anything but a clear no (${code}) starts the Mentor`, () => {
    assert.equal(mentorDeferred(answers(code)), false);
  });
}

test('a runner that gives nothing back starts the Mentor', () => {
  assert.equal(mentorDeferred(() => undefined), false);
});
