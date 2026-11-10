import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
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

test('a setup step whose program is not there is one sentence, never the stack trace of Node', () => {
  assert.equal(
    describeStepFailure('providers update', { missing: true }),
    '  providers update did not complete: the JHT program was not found here. More details: JHT_DEBUG=1 jht setup',
  );
  assert.match(describeStepFailure('team start', { status: 3 }), /it ended with code 3/);
  assert.doesNotMatch(describeStepFailure('x', { missing: true }), /\n|\/app/);
});

test('setup runs a sub-step with its stderr inherited: no buffer cap, no questions held back', () => {
  const source = readFileSync(fileURLToPath(new URL('../wizard/setup.js', import.meta.url)), 'utf8');
  const run = source.slice(source.indexOf('function runJhtSubcommand'), source.indexOf('function runProviderOauth'));
  assert.match(run, /stdio: 'inherit'/);
  assert.doesNotMatch(run, /'pipe'|maxBuffer/);
  assert.match(run, /existsSync\(entry\)/);
});

test('the experimental and undici warnings are dropped, any other warning passes, JHT_DEBUG keeps them', async () => {
  const { installWarningFilter } = await import('../src/lib/quiet-warnings.js');
  const make = (env = {}) => {
    const seen = [];
    const proc = { env, emitWarning: (w, ...r) => seen.push([String(w?.message ?? w), r[0]]) };
    installWarningFilter(proc);
    return { proc, seen };
  };
  const quiet = make();
  quiet.proc.emitWarning('SQLite is an experimental feature and might change at any time', 'ExperimentalWarning');
  quiet.proc.emitWarning('Something else is experimental', 'ExperimentalWarning');
  // what undici emits on a computer with a system proxy: the options form, type «Warning», its own code
  quiet.proc.emitWarning('EnvHttpProxyAgent is experimental, expect them to change at any time.', { type: 'Warning', code: 'UNDICI-EHPA' });
  quiet.proc.emitWarning('Another message of undici', 'Warning', 'UNDICI-XYZ');
  quiet.proc.emitWarning('The buffer is deprecated', 'DeprecationWarning');
  quiet.proc.emitWarning('Possible listeners leak', 'MaxListenersExceededWarning');
  assert.deepEqual(quiet.seen.map(([text]) => text), ['The buffer is deprecated', 'Possible listeners leak']);
  const debug = make({ JHT_DEBUG: '1' });
  debug.proc.emitWarning('SQLite is an experimental feature', 'ExperimentalWarning');
  debug.proc.emitWarning('EnvHttpProxyAgent is experimental', { type: 'Warning', code: 'UNDICI-EHPA' });
  assert.equal(debug.seen.length, 2);
});

test('a real process: the proxy warning of undici never reaches stderr, the deprecation one does', () => {
  const filter = new URL('../src/lib/quiet-warnings.js', import.meta.url).href;
  const code = `import(${JSON.stringify(filter)}).then(({ installWarningFilter }) => { installWarningFilter();
    process.emitWarning('EnvHttpProxyAgent is experimental, expect them to change at any time.', { type: 'Warning', code: 'UNDICI-EHPA' });
    process.emitWarning('old thing', 'DeprecationWarning'); });`;
  const run = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', env: { ...process.env, JHT_DEBUG: '' } });
  assert.doesNotMatch(run.stderr, /UNDICI|EnvHttpProxyAgent/);
  assert.match(run.stderr, /DeprecationWarning: old thing/);
});

test('the long help names the commands that live on the computer, up and down among them', () => {
  const { out } = jht(['help']);
  assert.match(out, /On your computer, outside the container:\n\s+up\s+Start the team\n\s+down\s+Stop it/);
});
