// After `jht team stop` the roster says `stopped` for the sessions closed: one call to team_roster.py stop-mark, best effort.
import assert from 'node:assert/strict';
import test from 'node:test';
import { markStopped } from '../src/commands/team/stop.js';

test('the sessions closed go to the roster as stopped by the user, in one call', () => {
  const seen = [];
  const ok = markStopped(['SCOUT-1', 'ANALISTA-2'], (argv, options) => { seen.push({ argv, options }); return { code: 0 }; });
  assert.equal(ok, true);
  assert.deepEqual(seen.map((s) => s.argv), [[
    'python3', '/app/shared/skills/team_roster.py', 'stop-mark', 'SCOUT-1', 'ANALISTA-2', '--by', 'user',
  ]]);
});

test('nothing closed: the roster is not called', () => {
  let called = false;
  assert.equal(markStopped([], () => { called = true; return { code: 0 }; }), false);
  assert.equal(called, false);
});

test('a roster that does not answer never throws: the stop happened anyway', () => {
  assert.equal(markStopped(['SCOUT-1'], () => ({ code: 1 })), false);
  assert.equal(markStopped(['SCOUT-1'], () => undefined), false);
});
