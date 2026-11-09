// `jht team stop --all` while the onboarding is open: the Assistente is the one agent working, so it is stopped too.
// Once the onboarding is closed the Assistente is kept alive (the user's chat), as it always was.
import assert from 'node:assert/strict';
import test from 'node:test';
import { onboardingOpen, stopAllTargets } from '../src/commands/team/stop.js';

const answers = (code) => (argv, options) => {
  answers.seen = { argv, options };
  return { code };
};

test('exit 1 from captain_gate: the onboarding is open', () => {
  assert.equal(onboardingOpen(answers(1)), true);
  assert.deepEqual(answers.seen.argv, ['python3', '/app/shared/skills/captain_gate.py']);
});

for (const code of [0, 2, 127, 124, -1, null, undefined]) {
  test(`anything but a clear «open» (${code}) keeps the Assistente`, () => {
    assert.equal(onboardingOpen(answers(code)), false);
  });
}

test('a runner that answers nothing keeps the Assistente', () => {
  assert.equal(onboardingOpen(() => undefined), false);
});

test('with the onboarding open, stop --all closes the Assistente and what else runs', () => {
  assert.deepEqual(stopAllTargets(['ASSISTENTE'], { assistantStops: true }), ['ASSISTENTE']);
  assert.deepEqual(stopAllTargets(['ASSISTENTE', 'SENTINELLA', 'TMUX-OTHER'], { assistantStops: true }), ['ASSISTENTE', 'SENTINELLA']);
});

test('with the onboarding closed the Assistente stays, the rest goes: «No active agents» is for nothing running', () => {
  assert.deepEqual(stopAllTargets(['ASSISTENTE'], {}), []);
  assert.deepEqual(stopAllTargets(['ASSISTENTE', 'CAPITANO', 'SCOUT-1']), ['CAPITANO', 'SCOUT-1']);
  assert.deepEqual(stopAllTargets(['ASSISTENTE', 'DOTTORE'], { assistantStops: false }), ['DOTTORE']);
});

test('the legacy host prefix is the same session', () => {
  assert.deepEqual(stopAllTargets(['JHT-ASSISTENTE'], { assistantStops: true }), ['JHT-ASSISTENTE']);
  assert.deepEqual(stopAllTargets(['JHT-ASSISTENTE'], {}), []);
});
