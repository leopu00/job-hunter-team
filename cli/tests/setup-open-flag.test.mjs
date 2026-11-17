// The flag of a setup that is open: the watchdogs and the start of the container read it, a killed setup's flag expires.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSetup, closeSetup, setupOpen, setupOpenPath, SETUP_OPEN_MAX_MS } from '../src/lib/setup-open.js';

test('open, seen, closed', () => {
  const home = mkdtempSync(join(tmpdir(), 'jht-setup-open-'));
  assert.equal(setupOpen(home), false);
  assert.equal(openSetup(home), true);
  assert.equal(setupOpen(home), true);
  closeSetup(home);
  assert.equal(setupOpen(home), false);
  assert.equal(existsSync(setupOpenPath(home)), false);
});

test('a flag left by a killed setup is no longer good after two hours', () => {
  const home = mkdtempSync(join(tmpdir(), 'jht-setup-open-'));
  openSetup(home);
  const old = new Date(Date.now() - SETUP_OPEN_MAX_MS - 60_000);
  utimesSync(setupOpenPath(home), old, old);
  assert.equal(setupOpen(home), false);
});

test('a home that does not exist leaves things as they were: no flag, no error', () => {
  assert.equal(openSetup('/nonexistent/jht-home'), false);
  assert.equal(setupOpen('/nonexistent/jht-home'), false);
  closeSetup('/nonexistent/jht-home');
});
