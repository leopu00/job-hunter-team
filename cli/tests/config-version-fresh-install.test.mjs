// A config the setup has just written is at the latest version: `jht doctor` has no migration to offer for it,
// and an older one still gets the offer.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { LATEST_CONFIG_VERSION, migrateToLatest } from '../src/commands/migrate.js';

const JHT = resolve(import.meta.dirname, '../bin/jht.js');

test('the latest version is the last migration', () => {
  assert.equal(LATEST_CONFIG_VERSION, 4);
});

test('a config at version 1 is brought to the latest, and doing it twice changes nothing more', () => {
  const fresh = { version: 1, active_provider: 'openai', providers: { openai: { model: 'x' } }, channels: {} };
  const once = migrateToLatest(JSON.parse(JSON.stringify(fresh)));
  assert.equal(once.version, LATEST_CONFIG_VERSION);
  assert.deepEqual(once.providers, fresh.providers);
  assert.ok(once.notifications && once.analytics && once.agents);
  assert.deepEqual(migrateToLatest(JSON.parse(JSON.stringify(once))), once);
  // a config already there is not touched backwards
  assert.equal(migrateToLatest({ version: 4, channels: {} }).version, 4);
});

function doctorSays(config) {
  const home = mkdtempSync(join(tmpdir(), 'jht-doctor-'));
  writeFileSync(join(home, 'jht.config.json'), JSON.stringify(config));
  const r = spawnSync(process.execPath, [JHT, 'doctor'], {
    encoding: 'utf8', timeout: 60000,
    env: { PATH: process.env.PATH, HOME: home, JHT_HOME: home, NO_COLOR: '1', JHT_LANG: 'en' },
  });
  return `${r.stdout}${r.stderr}`;
}

test('jht doctor offers no migration for a config made at the latest version, and does for an old one', () => {
  const fresh = migrateToLatest({ version: 1, active_provider: 'openai', providers: { openai: {} }, channels: {} });
  assert.doesNotMatch(doctorSays(fresh), /update available|jht migrate/);
  assert.match(doctorSays({ version: 1, active_provider: 'openai', providers: { openai: {} } }), /Config v1/);
});

test('the setup writes its config through the migrations', () => {
  const steps = readFileSync(resolve(import.meta.dirname, '../wizard/setup-steps.js'), 'utf8');
  assert.match(steps, /const config = migrateToLatest\(\{/);
});
