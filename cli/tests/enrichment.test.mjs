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
const { SWITCH_KEYS, closedCosts, closedPolicy, closedRequest, costCell, costText, describe, extraCost, typedValue } = await import('../src/lib/enrichment.js');
const { isYes, runPolicy, setSwitch } = await import('../src/commands/enrichment.js');
const { applyResult, getResult, withEnrichment } = await import('../src/commands/team-settings.js');
const { runSettings } = await import('../src/commands/agent-control.js');

const CLI = resolve(import.meta.dirname, '../bin/jht.js');
const POLICY = {
  economy: false,
  logo: { enabled: true, min_score: null },
  geocode_pipeline: { enabled: true },
  geocode_missing: { enabled: true, min_score: null, non_remote_only: true },
  recheck_weekly: { enabled: true, min_score: 70, older_than_days: 14 },
  web_search: { analista: { enabled: false }, scout: { enabled: true }, mentor: { enabled: true } },
};
// a synthetic table of costs, in the shape of shared/skills/enrichment_costs.json
const COSTS = {
  positions_per_day: 50,
  switches: {
    economy: { costly: false, usd_per_position: 0.01 },
    'logo.enabled': { costly: true, usd_per_position: 0.004 },
    'recheck_weekly.enabled': { costly: true, usd_per_position: null },
    'web_search.analista.enabled': { costly: true, usd_per_position: 0.27 },
    'web_search.scout.enabled': { costly: true, usd_per_position: null, usd_per_search: 0.02 },
  },
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
  assert.equal(closedPolicy(answer({ ...POLICY, web_search: { ...POLICY.web_search, analista: { enabled: 'no' } } })), null);
  assert.equal(closedPolicy(answer({ ...POLICY, web_search: undefined })), null);
});

test('the costs come in their closed shape: what is off it is left out, a doubtful table is none, and the policy is read all the same', () => {
  const sent = { version: 1, ...COSTS, switches: { ...COSTS.switches,
    'logo.enabled': { costly: true, usd_per_position: 0.004, basis: 'measured on Haiku' },
    'logo.min_score': { costly: true, usd_per_position: 1 },
    'geocode_pipeline.enabled': { costly: 'yes', usd_per_position: 1 },
    'geocode_missing.enabled': { costly: true, usd_per_position: -1 },
    'web_search.writer.enabled': { costly: true, usd_per_position: 1 } } };
  assert.deepEqual(closedCosts(sent), COSTS);
  assert.deepEqual(closedPolicy({ ...answer(), costs: sent }), { policy: POLICY, mode: 'search', costs: COSTS });
  assert.equal(closedCosts({ switches: {} }), null);
  assert.equal(closedCosts({ positions_per_day: 0, switches: {} }), null);
  assert.equal(closedCosts('cheap'), null);
  assert.deepEqual(closedPolicy({ ...answer(), costs: 'cheap' }), { policy: POLICY, mode: 'search' });
});

test('the extra cost is said only toward the dearer side, in the person’s language', () => {
  assert.deepEqual(extraCost('web_search.analista.enabled', false, true, COSTS), { perPosition: 0.27, perDay: 13.5, positionsPerDay: 50 });
  assert.equal(extraCost('web_search.analista.enabled', true, false, COSTS), null);
  assert.equal(extraCost('web_search.analista.enabled', true, true, COSTS), null);
  assert.equal(extraCost('economy', false, true, COSTS), null);
  assert.deepEqual(extraCost('economy', true, false, COSTS), { perPosition: 0.01, perDay: 0.5, positionsPerDay: 50 });
  assert.deepEqual(extraCost('web_search.scout.enabled', false, true, COSTS), { perSearch: 0.02 });
  assert.deepEqual(extraCost('recheck_weekly.enabled', false, true, COSTS), { unmeasured: true });
  assert.equal(extraCost('geocode_pipeline.enabled', false, true, COSTS), null);
  assert.equal(extraCost('web_search.analista.enabled', false, true, undefined), null);
  assert.equal(costText('web_search.analista.enabled', extraCost('web_search.analista.enabled', false, true, COSTS), 'it'),
    'Ricerca web degli Analisti: costa circa 0,27 $ in più a posizione (13,50 $ su 50 al giorno).');
  assert.equal(costText('logo.enabled', extraCost('logo.enabled', false, true, COSTS), 'en'),
    'Company logo: costs about 0.004 $ more per position (0.20 $ on 50 a day).');
  assert.equal(costText('economy', extraCost('economy', true, false, COSTS), 'de'),
    'Sparen ausschalten: kostet etwa 0,01 $ mehr pro Stelle (0,50 $ bei 50 pro Tag).');
  assert.equal(costText('web_search.scout.enabled', { perSearch: 0.02 }, 'fr'), 'Recherche web du Scout : coûte environ 0,02 $ par recherche.');
  assert.equal(costText('recheck_weekly.enabled', { unmeasured: true }, 'it'),
    'Ricontrollo delle posizioni vive (cura): costa di più; quanto non è ancora misurato.');
  assert.equal(costText('logo.enabled', null, 'it'), '');
});

test('set toward a dearer side asks first: a yes writes, a no writes nothing, no terminal is a refusal with the sentence, --yes skips it', async () => {
  process.env.JHT_LANG = 'it';
  const skill = (policy = POLICY) => {
    const asked = [];
    const run = (name, args, opts) => {
      asked.push(args[0]);
      return { code: 0, stdout: JSON.stringify({ ...answer(policy), costs: COSTS }), opts };
    };
    return { run, asked };
  };
  let s = skill();
  const refused = await setSwitch('web_search.analista.enabled', true, { run: s.run });
  assert.equal(refused.refused, 'confirm_needed');
  assert.equal(refused.exit, 1);
  assert.equal(refused.sentence, 'Ricerca web degli Analisti: costa circa 0,27 $ in più a posizione (13,50 $ su 50 al giorno).');
  assert.deepEqual(s.asked, ['show']);
  s = skill();
  let question = '';
  const no = await setSwitch('web_search.analista.enabled', true, { run: s.run, ask: async (q) => { question = q; return false; } });
  assert.deepEqual(no, { exit: 0, cancelled: true });
  assert.match(question, /13,50 \$ su 50 al giorno\)\.\nConfermi\? \[s\/N\]/);
  assert.deepEqual(s.asked, ['show']);
  s = skill();
  assert.equal((await setSwitch('web_search.analista.enabled', true, { run: s.run, ask: async () => true })).exit, 0);
  assert.deepEqual(s.asked, ['show', 'apply']);
  s = skill();
  assert.equal((await setSwitch('web_search.analista.enabled', true, { run: s.run, yes: true })).exit, 0);
  assert.deepEqual(s.asked, ['show', 'apply']);
  // the cheaper side, a threshold, and a team without a table: no question
  for (const [key, value] of [['web_search.scout.enabled', false], ['economy', true], ['recheck_weekly.min_score', 40]]) {
    s = skill();
    assert.equal((await setSwitch(key, value, { run: s.run })).exit, 0, key);
    assert.deepEqual(s.asked, ['show', 'apply'], key);
  }
  const bare = [];
  const plain = (name, args) => { bare.push(args[0]); return { code: 0, stdout: JSON.stringify(answer()) }; };
  assert.equal((await setSwitch('web_search.analista.enabled', true, { run: plain })).exit, 0);
  assert.deepEqual(bare, ['show', 'apply']);
});

test('a yes is a yes word of the person’s language, nothing else', () => {
  assert.equal(isYes('sì', 'it'), true);
  assert.equal(isYes(' S ', 'it'), true);
  assert.equal(isYes('ja', 'de'), true);
  assert.equal(isYes('igen', 'hu'), true);
  assert.equal(isYes('y', 'fr'), true);
  assert.equal(isYes('', 'it'), false);
  assert.equal(isYes('no', 'it'), false);
  assert.equal(isYes('sicuro', 'it'), false);
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

test('show: next to each switch the estimated cost of its dearer side, from the table the confirmation reads', () => {
  process.env.JHT_LANG = 'en';
  const text = describe({ policy: POLICY, mode: 'search', costs: COSTS });
  const row = (label) => text.split('\n').find((line) => line.trimStart().startsWith(label));
  assert.match(row('Savings'), /off +off: about 0\.01 \$ per position$/);
  assert.match(row('Company logo'), /on +on: about 0\.004 \$ per position$/);
  assert.match(row('Recheck of the live positions'), /on: cost not measured yet$/);
  assert.match(row('Web search of the Analisti'), /off +on: about 0\.27 \$ per position$/);
  assert.match(row('Web search of the Scout'), /on: about 0\.02 \$ per search$/);
  // a switch the table does not price has no column, and the note says what the figures are
  assert.match(row('Office on the map, new positions'), /on, not for remote positions$/);
  assert.match(text, /Estimated costs, measured with the agents on Haiku/);
});

test('show: both switches of a row are priced, the remote positions said as such, in the person’s language', () => {
  const costs = { positions_per_day: 50, switches: {
    'geocode_pipeline.enabled': { costly: true, usd_per_position: 0.001 },
    'geocode_missing.non_remote_only': { costly: false, usd_per_position: 0.001 } } };
  process.env.JHT_LANG = 'it';
  const row = describe({ policy: POLICY, mode: 'search', costs }).split('\n').find((line) => line.includes('Ufficio sulla mappa, posizioni nuove'));
  assert.match(row, /acceso: circa 0,001 \$ a posizione; anche le posizioni remote: circa 0,001 \$ a posizione$/);
  assert.equal(costCell('logo.enabled', COSTS, 'fr'), 'allumé : environ 0,004 $ par offre');
  assert.equal(costCell('geocode_pipeline.enabled', COSTS, 'fr'), '');
  assert.equal(costCell('logo.enabled', undefined, 'fr'), '');
  process.env.JHT_LANG = 'en';
});

test('show: with no table of the costs it reads as before, with no cost column and no note', () => {
  process.env.JHT_LANG = 'en';
  const text = describe({ policy: POLICY, mode: 'search' });
  assert.match(text, /Company logo +on$/m);
  assert.doesNotMatch(text, /per position|Estimated costs/);
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
    // the costs of the repo's own table, next to each switch
    assert.match(shown.stdout, /Ricerca web degli Analisti +spento +acceso: circa [\d,]+ \$ a posizione/);
    assert.match(shown.stdout, /Ricerca web dello Scout +acceso +acceso: circa [\d,]+ \$ a ricerca/);
    assert.match(shown.stdout, /Costi stimati, misurati con gli agenti su Haiku/);
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
    // toward the dearer side without a terminal: refused with the sentence, nothing written; --yes writes it
    const dearer = jht('enrichment', 'set', 'web_search.analista.enabled', 'on');
    assert.equal(dearer.status, 1);
    assert.match(dearer.stderr, /Ricerca web degli Analisti: costa circa [\d,]+ \$ in più a posizione \([\d,]+ \$ su \d+ al giorno\)\.\nPer confermare, rilancia lo stesso comando con --yes\./);
    assert.deepEqual(JSON.parse(readFileSync(join(root, 'profile', 'enrichment-policy.json'), 'utf-8')), file);
    const refusedJson = JSON.parse(jht('enrichment', 'set', 'web_search.analista.enabled', 'on', '--json').stdout);
    assert.equal(refusedJson.code, 'confirm_needed');
    const yes = jht('enrichment', 'set', 'web_search.analista.enabled', 'on', '--yes', '--json');
    assert.equal(yes.status, 0, yes.stderr);
    assert.deepEqual(JSON.parse(yes.stdout).policy.web_search.analista, { enabled: true });
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
        const names = key.split('.');
        const last = names.pop();
        names.reduce((node, name) => node[name], state.policy)[last] = value;
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

test('the Analisti are named in the language of the person, not with the Italian plural (retest Windows build13, French)', async () => {
  const { say } = await import('../src/lib/texts.js');
  for (const lang of ['en', 'hu', 'es', 'de', 'fr', 'pt']) {
    for (const key of ['enrichment.description', 'enrichment.title', 'enrichment.web_search_analista']) {
      assert.doesNotMatch(say(key, { mode: 'search' }, lang), /Analisti/, `${lang} ${key}`);
    }
  }
  assert.equal(say('enrichment.web_search_analista', {}, 'fr'), 'Recherche web des Analystes');
});
