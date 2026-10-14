import assert from 'node:assert/strict';
import test from 'node:test';
import { runExistingTeamAdapter } from '../src/lib/existing-team-adapter.js';

const PROFILE = 'a'.repeat(64);

test('invalid adapter input is rejected before the companion starts', () => {
  let spawned = false;
  const result = runExistingTeamAdapter(
    { op: 'list', profileId: PROFILE, filters: null },
    { spawn() { spawned = true; throw new Error('must not spawn'); } },
  );
  assert.equal(result.code, 64);
  assert.equal(result.value.error, 'adapter_request_invalid');
  assert.equal(spawned, false);
});

test('valid typed input reports a missing companion without PATH lookup', () => {
  const result = runExistingTeamAdapter(
    { op: 'facets', profileId: PROFILE },
    { env: { PATH: '/definitely-empty' } },
  );
  assert.equal(result.code, 69);
  assert.equal(result.value.error, 'existing_team_adapter_unavailable');
});
