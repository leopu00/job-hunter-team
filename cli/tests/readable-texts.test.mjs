import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeStepFailure } from '../wizard/setup.js';
import { retiredStoreDetail, retiredStoreNotice } from '../src/commands/_retired-stores.js';

// Texts a person reads must not carry the project's own history or its plumbing: dates of retired components,
// the names of the scripts behind a command, a stack trace in the middle of the wizard, the release pin.
const entry = fileURLToPath(new URL('../bin/jht.js', import.meta.url));

function jht(args, extraEnv = {}) {
  const home = mkdtempSync(join(tmpdir(), 'jht-readable-'));
  const result = spawnSync(process.execPath, [entry, ...args], {
    env: { PATH: process.env.PATH, HOME: home, JHT_HOME: join(home, '.jht'), LANG: 'en_US.UTF-8', ...extraEnv },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000,
  });
  return { out: `${result.stdout}${result.stderr}`, status: result.status };
}

test('the notice of a retired store says it once, without dates or interface names', () => {
  const text = retiredStoreNotice(['sessions']) + retiredStoreDetail('tasks');
  assert.doesNotMatch(text, /\d\d\/\d\d\/\d{4}|text interface|written by any component/);
  assert.match(text, /jht positions, jht agents, jht status/);
});

test('health, stats and sessions do not tell the history of the project', () => {
  for (const args of [['health'], ['stats'], ['sessions']]) {
    const { out } = jht(args);
    assert.doesNotMatch(out, /25\/07\/2026|retired text interface|no component has written|no remaining data source/, args.join(' '));
  }
  assert.match(jht(['health']).out, /no longer used/);
});

test('the command list shows no plumbing: no script names, no "(proxy …)"', () => {
  for (const args of [['help'], ['positions', '--help'], ['ticket', '--help']]) {
    assert.doesNotMatch(jht(args).out, /proxy (to|at)|\.py\b/, args.join(' '));
  }
});

test('team list names no internal source unless JHT_DEBUG is set', () => {
  assert.doesNotMatch(jht(['team', 'list']).out, /source: (tmux host|jht container)/);
  assert.match(jht(['team', 'list'], { JHT_DEBUG: '1' }).out, /source: (tmux host|jht container)/);
});

test('a setup step that fails is one sentence, never the child\'s stack trace', () => {
  const trace = [
    'node:internal/modules/cjs/loader:1595',
    '  throw err;',
    "Error: Cannot find module '/app/cli/bin/jht.js'",
    '    at Module._resolveFilename (node:internal/modules/cjs/loader:1591:15)',
    "  code: 'MODULE_NOT_FOUND',",
  ].join('\n');
  const sentence = describeStepFailure('providers update', trace);
  assert.match(sentence, /providers update did not complete: the JHT program could not be started here/);
  assert.doesNotMatch(sentence, /at Module|loader:|throw err|\/app\/cli/);
  // a step with its own message keeps that message
  assert.match(describeStepFailure('providers update', 'Error: npm could not reach the registry\n    at x'), /did not complete: npm could not reach the registry/);
  assert.doesNotMatch(describeStepFailure('x', 'Error: boom\n    at y'), /\n/);
});
