import assert from 'node:assert/strict';
import test from 'node:test';
import { runExistingTeamAdapter } from '../src/lib/existing-team-adapter.js';

const PROFILE = 'a'.repeat(64);
const RESOLVE = () => '/fixed/jht-existing-team';

function reply(value, status = 0) {
  return () => ({ status, stdout: JSON.stringify(value) });
}

function blocked(request) {
  let spawned = false;
  const result = runExistingTeamAdapter(request, {
    resolve: RESOLVE,
    spawn() { spawned = true; throw new Error('must not spawn'); },
  });
  assert.equal(result.code, 64);
  assert.equal(result.value.error, 'adapter_request_invalid');
  assert.equal(spawned, false);
}

test('invalid adapter boundaries are rejected before the companion starts', () => {
  blocked({ op: 'list', profileId: PROFILE, filters: null });
  blocked({ op: 'facets', profileId: PROFILE, unexpected: true });
  blocked({ op: 'list', profileId: PROFILE, filters: { q: 'x'.repeat(9000) } });
  blocked({ op: 'list', profileId: PROFILE, filters: { q: 7 } });
  blocked({ op: 'list', profileId: PROFILE, filters: { limit: Number.POSITIVE_INFINITY } });
});

test('typed list filters reach the companion with the external timeout margin', () => {
  let options;
  const request = { op: 'list', profileId: PROFILE, filters: { q: 'engineer', limit: 10 } };
  const result = runExistingTeamAdapter(request, {
    resolve: RESOLVE,
    spawn(_path, _args, received) {
      options = received;
      return { status: 0, stdout: JSON.stringify({ ok: true, phase: 'read', code: 0, data: { items: [] } }) };
    },
  });
  assert.equal(options.timeout, 40_000);
  assert.deepEqual(JSON.parse(options.input), request);
  assert.deepEqual(result, { code: 0, value: { ok: true, phase: 'read', code: 0, data: { items: [] } } });
});

test('synthetic companion envelopes preserve list detail and facets core data', () => {
  const cases = [
    [{ op: 'list', profileId: PROFILE }, { items: [{ id: '1' }] }],
    [{ op: 'detail', profileId: PROFILE, id: '1' }, null],
    [{ op: 'facets', profileId: PROFILE }, { items: [{ id: '1', status: 'new' }] }],
  ];
  for (const [request, data] of cases) {
    const result = runExistingTeamAdapter(request, {
      resolve: RESOLVE,
      spawn: reply({ ok: true, phase: 'read', code: 0, data }),
    });
    assert.equal(result.code, 0);
    assert.deepEqual(result.value.data, data);
  }
});

test('a core read error preserves its nonzero process status', () => {
  const result = runExistingTeamAdapter(
    { op: 'facets', profileId: PROFILE },
    { resolve: RESOLVE, spawn: reply({ ok: false, phase: 'read', code: 69, error: 'positions_unavailable' }, 69) },
  );
  assert.equal(result.code, 69);
  assert.deepEqual(result.value, { ok: false, phase: 'read', code: 69, error: 'positions_unavailable' });
});

test('valid typed input reports a missing companion without PATH lookup', () => {
  const result = runExistingTeamAdapter(
    { op: 'facets', profileId: PROFILE },
    { env: { PATH: '/definitely-empty' } },
  );
  assert.equal(result.code, 69);
  assert.equal(result.value.error, 'existing_team_adapter_unavailable');
});
