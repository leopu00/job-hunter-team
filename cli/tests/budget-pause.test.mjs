// The pause of the brake of pi on the budget of the person (JHT-T322), as jht doctor, jht team status and jht team start say it:
// the budget spent, the period over, the pace (resumes by itself, or not before the end). Synthetic flags in made-up homes.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

process.env.JHT_LANG = 'en';
const awaitedModule = await import('../src/lib/budget-pause.js');
const { budgetPause, budgetPauseText, whenOf } = awaitedModule;
const { say, show } = await import('../src/lib/texts.js');
const JHT = fileURLToPath(new URL('../bin/jht.js', import.meta.url));

function home(flag) {
  const root = mkdtempSync(join(tmpdir(), 'jht-budget-pause-'));
  mkdirSync(join(root, 'logs'));
  if (flag !== undefined) writeFileSync(join(root, 'logs', 'daily-halt.flag'), typeof flag === 'string' ? flag : JSON.stringify(flag));
  return root;
}
const cap = (over) => ({ reason: 'pi_spend_cap', pi_spend_cap: { spent: 4.93, ceiling: 5, budget_usd: 5, ends_at: '2026-11-16T08:00:00+01:00', resumes_at: null, ...over } });
// 22:30 in Rome
const NOW = new Date('2026-11-15T21:30:00Z');
const text = (flag, language = 'en') => { const t = budgetPauseText({ home: home(flag), now: NOW }); return t && show(t, language); };

test('the budget spent and the period over: what was spent, and the way on is a new budget', () => {
  assert.equal(text(cap({ why: 'budget' })), 'The team is paused: it spent $4.93 of its budget of $5.00. To go on, set a new budget with: jht setup');
  assert.equal(text(cap({ why: 'budget' }), 'it'), 'La squadra è in pausa: ha speso 4.93 $ del suo budget di 5.00 $. Per andare avanti metti un nuovo budget con: jht setup');
  assert.equal(text(cap({ why: 'period', spent: 3.1 })), 'The team is paused: the period of its budget ended at 16/11 8:00 ($3.10 of $5.00 spent). To go on, set a new budget with: jht setup');
});

test('the pace: it resumes by itself at the hour the brake says, in the zone the brake wrote; or it does not before the end', () => {
  assert.equal(text(cap({ why: 'pace', spent: 2.4, ceiling: 2.1, resumes_at: '2026-11-15T23:10:00+01:00' })),
    'The team is paused to spread its budget over the period ($2.40 spent, $2.10 allowed so far): it resumes by itself at 23:10.');
  assert.match(text(cap({ why: 'pace', spent: 2.4, ceiling: 2.1, resumes_at: null })), /does not resume before the period ends at 16\/11 8:00\. To go on, set a new budget/);
  assert.equal(whenOf('2026-11-16T03:10:00+01:00', NOW), '16/11 3:10');
  assert.equal(whenOf('2026-11-15T23:59:00+01:00', NOW), '23:59');
  assert.equal(whenOf('not a date', NOW), null);
});

test('no flag, a flag of another brake (the daily cap, the old ceiling in eur, the credit), a broken flag: no pause of the budget', () => {
  assert.equal(budgetPause({ home: home() }), null);
  assert.equal(budgetPause({ home: home({ reason: 'daily-cap', pct: 101 }) }), null);
  for (const why of ['eur', 'tokens', 'credit']) assert.equal(budgetPause({ home: home(cap({ why })) }), null, why);
  assert.equal(budgetPause({ home: home('{ not json') }), null);
});

test('every text of the pause is in English and in Italian', () => {
  for (const key of ['budget.paused_budget', 'budget.paused_period', 'budget.paused_pace', 'budget.paused_pace_late']) {
    assert.notEqual(say(key, {}, 'en'), key);
    assert.notEqual(say(key, {}, 'it'), say(key, {}, 'en'), key);
  }
});

test('jht doctor says the pause of the budget with the way on, and nothing when the team is not paused on it', () => {
  const doctor = (root) => spawnSync(process.execPath, [JHT, 'doctor'], { encoding: 'utf8', timeout: 60_000,
    env: { ...process.env, JHT_HOME: root, JHT_LANG: 'en', NO_COLOR: '1' } }).stdout;
  assert.match(doctor(home(cap({ why: 'budget' }))), /The team is paused: it spent \$4\.93 of its budget of \$5\.00\. To go on, set a\s+new budget with: jht setup/);
  assert.doesNotMatch(doctor(home()), /paused/);
});

test('most of the budget went to the onboarding: said when what was spent before the first work is over half of THIS budget, in doctor too', () => {
  const { onboardingSpendText } = awaitedModule;
  const setup = (spentBefore, startSaved = '2026-11-16T09:00:00.000Z') => {
    const root = home();
    mkdirSync(join(root, 'state'));
    writeFileSync(join(root, 'state', 'budget-start.json'), JSON.stringify({ saved_at: startSaved, starts_at: '2026-11-16T09:20:00.000Z', spent_before_usd: spentBefore }));
    writeFileSync(join(root, 'jht.config.json'), JSON.stringify({ team: { budget: { usd: 2, duration_minutes: 1440, saved_at: '2026-11-16T09:00:00.000Z', set_by: 'setup' } } }));
    return root;
  };
  assert.equal(show(onboardingSpendText({ home: setup(1.71) }), 'en'),
    '$1.71 of your $2.00 budget went to the onboarding and the Capitano before the Scouts started searching: with a budget this small the team has little left to search with. Raise it with: jht setup');
  assert.match(show(onboardingSpendText({ home: setup(1.71) }), 'it'), /^1\.71 \$ del tuo budget di 2\.00 \$ sono andati nell'onboarding/);
  assert.equal(onboardingSpendText({ home: setup(0.9) }), null, 'under half: nothing to say');
  assert.equal(onboardingSpendText({ home: setup(1.71, '2026-11-15T09:00:00.000Z') }), null, 'the file of another budget is old');
  assert.equal(onboardingSpendText({ home: home() }), null, 'no file');
  const doctor = spawnSync(process.execPath, [JHT, 'doctor'], { encoding: 'utf8', timeout: 60_000, env: { ...process.env, JHT_HOME: setup(1.71), JHT_LANG: 'en', NO_COLOR: '1' } }).stdout;
  assert.match(doctor, /\$1\.71 of your \$2\.00 budget went to the onboarding/);
});
