// `jht cache` looks for the Codex logs database where Codex keeps it: in CODEX_SQLITE_HOME when the compose sets
// it (the databases live in the volume, docs/adr/0013), in the Codex home of the person otherwise.
import assert from 'node:assert/strict';
import test from 'node:test';
import { codexSqliteDir } from '../src/commands/cache.js';

test('the databases are in the folder the compose names', () => {
  assert.equal(codexSqliteDir({ CODEX_SQLITE_HOME: '/opt/jht-deps/codex-state' }, '/home-x'), '/opt/jht-deps/codex-state');
});

test('without the variable, or with an empty one, they stay in the Codex home', () => {
  assert.equal(codexSqliteDir({}, '/home-x'), '/home-x/.codex');
  assert.equal(codexSqliteDir({ CODEX_SQLITE_HOME: '' }, '/home-x'), '/home-x/.codex');
  assert.equal(codexSqliteDir({ CODEX_SQLITE_HOME: '   ' }, '/home-x'), '/home-x/.codex');
});
