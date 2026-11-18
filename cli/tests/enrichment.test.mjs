import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

// jht enrichment (JHT-T324): the switches of the Analisti's enrichments from a shell, and the `enrichment` field the desktop
// reads and writes through jht team-settings. The rules are enrichment_policy.py's; here what a person types, the closed
// shapes, and the words. Synthetic homes only.
const home = mkdtempSync(join(tmpdir(), 'jht-enrichment-'));
process.env.JHT_HOME = home;
const { SWITCH_KEYS, closedPolicy, closedRequest, describe, typedValue } = await import('../src/lib/enrichment.js');
const { runPolicy } = await import('../src/commands/enrichment.js');
const { applyResult, getResult, withEnrichment } = await import('../src/commands/team-settings.js');
const { runSettings } = await import('../src/commands/agent-control.js');

const CLI = resolve(import.meta.dirname, '../bin/jht.js');
const POLICY = {
  economy: false,
  logo: { enabled: true, min_score: null },
  geocode_pipeline: { enabled: true },
  geocode_missing: { enabled: true, min_score: null, non_remote_only: true },
  recheck_weekly: { enabled: true, min_score: 70, older_than_days: 14 },
};
const answer = (policy = POLICY, mode = 'search') => ({ ok: true, path: '/home/x/profile/enrichment-policy.json', exists: true, policy, mode });

test('what a person types becomes a typed value, or nothing', () => {
  assert.equal(typedValue('economy', 'on'), true);
  assert.equal(typedValue('logo.enabled', 'OFF'), false);
  assert.equal(typedValue('logo.enabled', true), true);
  assert.equal(typedValue('logo.enabled', 'maybe'), undefined);
  assert.equal(typedValue('logo.min_score', '70'), 70);
  assert.equal(typedValue('logo.min_score', 'none'), null);
  assert.equal(typedValue('logo.min_score', null), null);
  assert.equal(typedValue('logo.min_score', '170'), undefined);
  assert.equal(typedValue('logo.min_score', '7.5'), undefined);
  assert.equal(typedValue('logo.min_score', true), undefined);
  assert.equal(typedValue('recheck_weekly.min_score', 'none'), undefined);
  assert.equal(typedValue('recheck_weekly.older_than_days', '0'), undefined);
  assert.equal(typedValue('recheck_weekly.older_than_days', '365'), 365);
  assert.equal(typedValue('geocode_pipeline.enabled', 'yes'), true);
  assert.equal(typedValue('logo.size', 'on'), undefined);
});

test('a patch is whole or nothing: one unknown key or one bad value and there is no request', () => {
  assert.deepEqual(closedRequest({ 'logo.enabled': false, 'logo.min_score': 70 }), { 'logo.enabled': false, 'logo.min_score': 70 });
  assert.equal(closedRequest({ 'logo.enabled': false, 'logo.size': 3 }), null);
  assert.equal(closedRequest({ 'logo.enabled': 'false' }), null);
  assert.equal(closedRequest({}), null);
  assert.equal(closedRequest([]), null);
  assert.equal(closedRequest(null), null);
});

test('the answer of the skill is read in its closed shape, without the path; anything off it is no reading', () => {
  assert.deepEqual(closedPolicy(answer()), { policy: POLICY, mode: 'search' });
  assert.equal(closedPolicy({ ...answer(), mode: 'party' }), null);
  assert.equal(closedPolicy(answer({ ...POLICY, logo: { enabled: 'yes', min_score: null } })), null);
  assert.equal(closedPolicy(answer({ ...POLICY, geocode_pipeline: undefined })), null);
  assert.equal(closedPolicy({ ok: false, code: 'value_invalid' }), null);
});

test('describe: one line per enrichment, the threshold shown only when there is one, and what the mode stops', () => {
  process.env.JHT_LANG = 'en';
  const text = describe({ policy: { ...POLICY, logo: { enabled: true, min_score: 70 }, geocode_pipeline: { enabled: false } }, mode: 'search' });
  assert.match(text, /working mode: search/);
  assert.match(text, /Company logo +on, from score 70/);
  assert.match(text, /Office on the map, new positions +off, not for remote positions/);
  assert.match(text, /Recheck of the live positions \(care\) +on, from score 70, older than 14 days/);
  assert.doesNotMatch(text, /saving mode/);
  assert.match(describe({ policy: POLICY, mode: 'saving' }), /The saving mode is on/);
  assert.match(describe({ policy: { ...POLICY, economy: true }, mode: 'search' }), /Savings is on/);
});

test('runPolicy: the skill’s refusals come through as closed codes, anything else is policy_unavailable', () => {
  const said = (stdout, code = 0) => () => ({ code, stdout, stderr: '' });
  assert.deepEqual(runPolicy(['show'], null, said(JSON.stringify(answer()))), { exit: 0, policy: POLICY, mode: 'search' });
  assert.deepEqual(runPolicy(['apply'], '{}', said('{"ok": false, "code": "value_invalid"}', 1)), { exit: 1, refused: 'value_invalid' });
  assert.deepEqual(runPolicy(['apply'], '{}', said('{"ok": false, "code": "something else"}', 1)), { exit: 1, refused: 'policy_unavailable' });
  assert.deepEqual(runPolicy(['show'], null, said('Traceback ...', 1)), { exit: 1, refused: 'policy_unavailable' });
  let asked;
  runPolicy(['apply'], '{"economy": true}', (skill, args, opts) => { asked = { skill, args, opts }; return { code: 0, stdout: JSON.stringify(answer()) }; });
  assert.deepEqual(asked, { skill: 'enrichment_policy.py', args: ['apply'], opts: { input: '{"economy": true}' } });
});

test('the command on the real program: show, set, and every refusal said in the person’s language (the repo’s skills)', () => {
  const root = mkdtempSync(join(tmpdir(), 'jht-enrichment-cli-'));
  try {
    const env = { ...process.env, JHT_HOME: root, JHT_LANG: 'it', HOME: root };
    const jht = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env });
    const shown = jht('enrichment', 'show');
    assert.equal(shown.status, 0, shown.stderr);
    assert.match(shown.stdout, /Arricchimenti degli Analisti \(modalità di lavoro: search\)/);
    const set = jht('enrichment', 'set', 'geocode_pipeline.enabled', 'off', '--json');
    assert.equal(set.status, 0, set.stderr);
    assert.deepEqual(JSON.parse(set.stdout).policy.geocode_pipeline, { enabled: false });
    const file = JSON.parse(readFileSync(join(root, 'profile', 'enrichment-policy.json'), 'utf-8'));
    assert.deepEqual(file.geocode_pipeline, { enabled: false });
    const bad = jht('enrichment', 'set', 'logo.min_score', '170');
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /Valore non valido per logo\.min_score: uno score da 0 a 100, oppure none\./);
    const unknown = jht('enrichment', 'set', 'logo.size', 'on', '--json');
    assert.equal(unknown.status, 2);
    assert.deepEqual(JSON.parse(unknown.stdout), { ok: false, code: 'key_unknown' });
    assert.deepEqual(JSON.parse(readFileSync(join(root, 'profile', 'enrichment-policy.json'), 'utf-8')), file);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('every switch the CLI knows is one the skill takes, and no other', () => {
  const skill = readFileSync(resolve(import.meta.dirname, '../../shared/skills/enrichment_policy.py'), 'utf-8');
  const settable = skill.slice(skill.indexOf('_SETTABLE = {'), skill.indexOf('}', skill.indexOf('_SETTABLE = {')));
  const keys = [...settable.matchAll(/^\s+"([a-z_.]+)": \(/gm)].map((m) => m[1]);
  assert.deepEqual([...keys].sort(), [...SWITCH_KEYS].sort());
});

// ── the desktop's door: jht team-settings ──────────────────────────────────────────────────────────────────────────────
const CONFIG = join(home, 'jht.config.json');
const put = (value) => writeFileSync(CONFIG, JSON.stringify(value));

/** A fake container: the policy skill answers `show` from `state` and takes `apply` into it; every call is kept. */
function box(state = { policy: structuredClone(POLICY) }, { refuse = null } = {}) {
  const calls = [];
  const exec = (script, argv, opts = {}) => {
    calls.push({ script, argv, input: opts.input ?? null });
    if (!script.endsWith('enrichment_policy.py')) return { ok: true, code: 1, stdout: '' };
    if (argv[0] === 'apply') {
      if (refuse) return { ok: true, code: 1, stdout: JSON.stringify({ ok: false, code: refuse }) };
      for (const [key, value] of Object.entries(JSON.parse(opts.input))) {
        const [section, field] = key.split('.');
        if (field) state.policy[section][field] = value; else state.policy[section] = value;
      }
    }
    return { ok: true, code: 0, stdout: JSON.stringify(answer(state.policy)) };
  };
  return { exec, calls, state };
}

test('team-settings get carries the switches when the skill gives them, and is what it was when it does not', () => {
  put({ active_provider: 'claude' });
  const { exec, calls } = box();
  const read = withEnrichment(getResult(), exec);
  assert.deepEqual(read.out.enrichment, { policy: POLICY, mode: 'search' });
  assert.deepEqual(calls.map((c) => c.argv), [['show']]);
  const silent = withEnrichment(getResult(), () => ({ ok: false, code: -1, stdout: '' }));
  assert.equal('enrichment' in silent.out, false);
  assert.equal(silent.out.ok, true);
});

test('team-settings apply: the switches go to the skill as one checked patch, then the answer is read again', () => {
  put({ active_provider: 'claude' });
  const { exec, calls } = box();
  const done = applyResult(JSON.stringify({ settings: { enrichment: { 'logo.enabled': false, 'logo.min_score': 70 } } }), CONFIG, exec);
  assert.equal(done.exit, 0);
  assert.deepEqual(done.out.enrichment.policy.logo, { enabled: false, min_score: 70 });
  assert.deepEqual(calls[0], { script: '/app/shared/skills/enrichment_policy.py', argv: ['apply'], input: '{"logo.enabled":false,"logo.min_score":70}\n' });
  assert.deepEqual(JSON.parse(readFileSync(CONFIG, 'utf-8')), { active_provider: 'claude' }); // the config is not touched
});

test('team-settings apply: one bad switch or one bad hour refuses everything, and nothing reaches the skill', () => {
  put({ active_provider: 'claude' });
  for (const settings of [
    { enrichment: { 'logo.enabled': 'no' } },
    { enrichment: { 'logo.size': 1 } },
    { enrichment: {} },
    { enrichment: { economy: true }, working_hours: { timezone: 'Europe/Rome', windows: [{ days: ['mon'], start: '09:00', end: '10:00' }] } },
  ]) {
    const { exec, calls } = box();
    assert.deepEqual(applyResult(JSON.stringify({ settings }), CONFIG, exec), { exit: 1, out: { ok: false, code: 'value_invalid' } });
    assert.deepEqual(calls, []);
  }
});

test('team-settings apply: a refusal of the skill is its closed code, and the config is then not written', () => {
  put({ active_provider: 'claude' });
  const { exec } = box(undefined, { refuse: 'write_failed' });
  const hours = { timezone: 'Europe/Rome', windows: [{ days: ['mon'], start: '09:00', end: '18:00' }] };
  const done = applyResult(JSON.stringify({ settings: { working_hours: hours, enrichment: { economy: true } } }), CONFIG, exec);
  assert.deepEqual(done, { exit: 1, out: { ok: false, code: 'write_failed' } });
  assert.deepEqual(JSON.parse(readFileSync(CONFIG, 'utf-8')), { active_provider: 'claude' });
  const odd = box(undefined, { refuse: 'disk on fire' });
  assert.deepEqual(applyResult(JSON.stringify({ settings: { enrichment: { economy: true } } }), CONFIG, odd.exec).out,
    { ok: false, code: 'enrichment_unavailable' });
});

test('the panel door: `agent-control settings get|apply` carries the switches too', () => {
  put({ active_provider: 'claude' });
  const { exec } = box();
  let written = '';
  assert.equal(runSettings(['get'], { write: (t) => { written = t; }, exec }), 0);
  assert.deepEqual(JSON.parse(written).enrichment, { policy: POLICY, mode: 'search' });
  const stdin = JSON.stringify({ settings: { enrichment: { 'recheck_weekly.older_than_days': 21 } } });
  assert.equal(runSettings(['apply'], { write: (t) => { written = t; }, readStdin: () => stdin, exec }), 0);
  assert.equal(JSON.parse(written).enrichment.policy.recheck_weekly.older_than_days, 21);
  assert.equal(existsSync(CONFIG), true);
});
