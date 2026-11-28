// The budget step of `jht setup` (cli/wizard/setup-budget.js): the four answers, the amount typed, the night until 8 in the zone of
// the person, and the line that says it. A scripted prompter, a fixed clock; nothing is asked to a person or a provider.
import assert from 'node:assert/strict';
import test from 'node:test';
import { BUDGET_CONFIRM_ABOVE, budgetPaceNote, budgetSummary, nextLocalHour, parseUsd, promptBudget } from '../wizard/setup-budget.js';

const en = (await import('../../shared/locales/en.json', { with: { type: 'json' } })).default;
const it = (await import('../../shared/locales/it.json', { with: { type: 'json' } })).default;
const catalog = (cat) => {
  const t = (key) => cat[key] ?? key;
  const tf = (key, ...args) => args.reduce((s, a) => s.replace(/%[ds]/, String(a)), t(key));
  return { t, tf };
};
const { t, tf } = catalog(en);

function prompter(answers) {
  const asked = [];
  return {
    asked,
    select: async (p) => { asked.push(['select', p.message, p.initialValue]); return answers[p.message] ?? p.initialValue; },
    text: async (p) => { asked.push(['text', p.message]); const a = answers[p.message]; return Array.isArray(a) ? a.shift() : a ?? p.initialValue; },
    confirm: async (p) => { asked.push(['confirm', p.message]); return answers.confirm ?? p.initialValue; },
    note: async (message) => { asked.push(['note', message]); },
  };
}
// 22:30 in Rome (UTC+1 in November)
const NOW = new Date('2026-11-15T21:30:00Z');

test('amounts: dollars with a point or a comma, never zero, negative or words', () => {
  assert.equal(parseUsd('10'), 10);
  assert.equal(parseUsd('7,5'), 7.5);
  assert.equal(parseUsd('$ 12.25'), 12.25);
  assert.equal(parseUsd('5 $'), 5);
  for (const bad of ['0', '-3', 'ten', '', '1e3', '2.345']) assert.equal(parseUsd(bad), null, bad);
});

test('every text of the step is in English and in Italian', () => {
  const keys = Object.keys(en).filter((k) => k.startsWith('wizard.budget.'));
  assert.ok(keys.length >= 20);
  for (const k of keys) assert.equal(typeof it[k], 'string', k);
});

test('--budget-until takes a time of the day as 8, 08, 08:00 or 08:30 (JHT-T345), and refuses one that is not', async () => {
  const { budgetFromOptions } = await import('../wizard/setup-budget.js');
  for (const hour of ['8', '08', '08:00']) {
    assert.equal(budgetFromOptions({ budgetUsd: '5', budgetUntil: hour }, { now: NOW, timeZone: 'Europe/Rome' }).budget.ends_at, '2026-11-16T07:00:00.000Z', hour);
  }
  assert.equal(budgetFromOptions({ budgetUsd: '5', budgetUntil: '08:30' }, { now: NOW, timeZone: 'Europe/Rome' }).budget.ends_at, '2026-11-16T07:30:00.000Z');
  for (const bad of ['24', '8:61', 'eight', '08:3']) assert.ok(budgetFromOptions({ budgetUsd: '5', budgetUntil: bad }, { now: NOW, timeZone: 'Europe/Rome' }).error, bad);
});

test('the budget is saved with the moment of the confirmation, not the one of the question', async () => {
  const { durationBudget, budgetOf, stampedAt } = await import('../wizard/setup-budget.js');
  const asked = new Date('2026-11-16T18:36:22Z');
  const confirmed = new Date('2026-11-16T18:46:44Z');
  const trial = stampedAt(durationBudget(5, 30, asked, 'Europe/Rome'), confirmed);
  assert.equal(trial.saved_at, confirmed.toISOString());
  assert.deepEqual([trial.usd, trial.duration_minutes, trial.timezone], [5, 30, 'Europe/Rome']);
  const night = budgetOf(5, new Date('2026-11-17T07:00:00Z'), asked, 'Europe/Rome');
  assert.deepEqual([stampedAt(night, confirmed).starts_at, stampedAt(night, confirmed).ends_at], [confirmed.toISOString(), night.ends_at]);
  const over = budgetOf(5, new Date('2026-11-16T18:40:00Z'), asked, 'Europe/Rome');
  assert.equal(stampedAt(over, confirmed), over, 'a night already over is left as it is');
  assert.equal(stampedAt(null, confirmed), null);
});

test('with the pace asked for a budget of more than an hour says it is spaced out; off it says it works until the budget is spent', () => {
  const t = (key) => ({ 'wizard.budget.pace_note': 'PACE', 'wizard.budget.pace_off_note': 'UNTIL SPENT' }[key] ?? key);
  assert.equal(budgetPaceNote(t, { budget: { usd: 5, duration_minutes: 30, pace: true } }), null);
  assert.equal(budgetPaceNote(t, { budget: { usd: 5, duration_minutes: 60 } }), null);
  assert.equal(budgetPaceNote(t, { budget: { usd: 3, duration_minutes: 24 * 60, pace: true } }), 'PACE');
  assert.equal(budgetPaceNote(t, { budget: { usd: 3, duration_minutes: 24 * 60 } }), 'UNTIL SPENT', 'the default is off');
  assert.equal(budgetPaceNote(t, { budget: null }), null, 'no limit, no pace');
});

test('the pace is asked only for a period over an hour, and only a yes turns it on', async () => {
  const { askPace } = await import('../wizard/setup-budget.js');
  const t = (key) => key;
  const ask = (answer) => { const seen = []; return { seen, confirm: async (o) => { seen.push(o); return answer; } }; };
  const day = { usd: 3, duration_minutes: 24 * 60 };
  const no = ask(false);
  assert.deepEqual(await askPace(no, { t, budget: day }), day);
  assert.equal(no.seen[0].initialValue, false, 'the default is no');
  assert.deepEqual(await askPace(ask(true), { t, budget: day }), { ...day, pace: true });
  const trial = ask(true);
  assert.deepEqual(await askPace(trial, { t, budget: { usd: 5, duration_minutes: 30 } }), { usd: 5, duration_minutes: 30 });
  assert.equal(trial.seen.length, 0, 'a trial of 30 minutes is not asked');
  assert.equal(await askPace(trial, { t, budget: null }), null);
});

test('--budget-pace turns the pace on in the budget of the options, and without it the budget has no pace', async () => {
  const { budgetFromOptions } = await import('../wizard/setup-budget.js');
  assert.equal(budgetFromOptions({ budgetUsd: '3', budgetDays: '1' }, { now: NOW, timeZone: 'UTC' }).budget.pace, undefined);
  assert.equal(budgetFromOptions({ budgetUsd: '3', budgetDays: '1', budgetPace: true }, { now: NOW, timeZone: 'UTC' }).budget.pace, true);
  assert.equal(budgetFromOptions({ budgetUsd: '5', budgetUntil: '8', budgetPace: true }, { now: NOW, timeZone: 'UTC' }).budget.pace, true);
});


// ── JHT-T345: amount and period proposed and changeable, a custom budget, free hours, a ceiling per day ──

const ALL = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

test('periods: minutes, hours, days in a few languages, and a time of the day', async () => {
  const { parseDuration, parseWorkDays, parseWorkTime } = await import('../wizard/setup-budget.js');
  const cases = { '30': 30, '30m': 30, '15 min': 15, '10 minuti': 10, '2h': 120, '1.5h': 90, '2 ore': 120, '3d': 4320, '3 giorni': 4320, '2 Tage': 2880 };
  for (const [text, minutes] of Object.entries(cases)) assert.deepEqual(parseDuration(text), { minutes }, text);
  assert.deepEqual(parseDuration('18:30'), { until: { hour: 18, minute: 30 } });
  assert.deepEqual(parseDuration('fino alle 8'), { until: { hour: 8, minute: 0 } });
  for (const bad of ['', 'soon', '0', '-5', '25:00', '8:5', '3 weeks']) assert.equal(parseDuration(bad), null, bad);
  assert.deepEqual([parseWorkDays('mon-fri'), parseWorkDays('sun,sat'), parseWorkDays('all')], [ALL.slice(0, 5), ['sat', 'sun'], ALL]);
  assert.equal(parseWorkDays('fri-mon'), null);
  assert.deepEqual(parseWorkTime('22:00-07:00'), { start: '22:00', end: '07:00' });
  for (const bad of ['9-18', '09:00-09:00', '09:00']) assert.equal(parseWorkTime(bad), null, bad);
});

test('jht budget --hours: a period in hours, like minutes and days; the setup keeps its own flags', async () => {
  const { budgetFromOptions } = await import('../wizard/setup-budget.js');
  const cli = { now: NOW, timeZone: 'UTC', prefix: '--', withHours: true };
  assert.deepEqual(budgetFromOptions({ budgetUsd: '3', budgetHours: '1.5' }, cli).budget.duration_minutes, 90);
  assert.match(budgetFromOptions({ budgetUsd: '3', budgetHours: '2', budgetMinutes: '5' }, cli).error, /one of --minutes <n>, --hours <n>, --days <n> or --until <HH:MM>/);
  // the setup has no --budget-hours: its sentence does not name one
  assert.match(budgetFromOptions({ budgetUsd: '3' }, { now: NOW, timeZone: 'UTC' }).error, /^Give the period with one of --budget-minutes <n>, --budget-days <n> or --budget-until <HH:MM>\.$/);
  assert.equal(budgetFromOptions({ budgetUsd: '3', budgetMinutes: '15' }, { now: NOW, timeZone: 'UTC', setBy: 'jht budget' }).budget.set_by, 'jht budget');
});

test('every new text of the budget is in the 7 languages', async () => {
  const keys = Object.keys(en).filter((k) => k.startsWith('wizard.budget.') || k.startsWith('wizard.cli.budget'));
  for (const lang of ['it', 'de', 'fr', 'es', 'pt', 'hu']) {
    const cat = (await import(`../../shared/locales/${lang}.json`, { with: { type: 'json' } })).default;
    for (const k of keys) assert.equal(typeof cat[k], 'string', `${lang} ${k}`);
  }
});


// ── JHT-T345b: the budget step as a person meets it. A recommended ceiling a day already chosen (Enter and on), few
// alternatives without the words of the tests, «I set it myself» one question at a time, and with a subscription no dollars.

const PROMPT = 'How much may the team spend?';
const HOURS = 'When does it work?';

test('Enter and on: $10 a day, every day, is the answer already chosen, with what half an hour of the team costs', async () => {
  const p = prompter({});
  const r = await promptBudget(p, { t, tf, now: NOW, timeZone: 'Europe/Rome', provider: 'openai' });
  assert.deepEqual(r, { kind: 'daily', budget: null, workingHours: null, dailyUsd: 10 });
  const ask = p.asked.find((a) => a[0] === 'select');
  assert.deepEqual([ask[1], ask[2]], [PROMPT, 'daily']);
  assert.equal(p.asked.filter((a) => a[0] === 'text' || a[0] === 'confirm').length, 0, 'nothing else is asked');
  const note = p.asked.find((a) => a[0] === 'note')[1];
  assert.equal(note, 'You pay your OpenAI account per use. With $10 a day the team works at full strength about 60-100 minutes every day (Scouts, Analisti and Scorer cost about $3-5 every half hour). On the first day $1-2 go into preparing your profile.');
  assert.equal(budgetSummary(t, tf, r), 'The team can spend at most $10 a day, at any hour; every day it starts again.');
  const i = catalog(it);
  assert.equal(budgetSummary(i.t, i.tf, { ...r, lang: 'it' }), 'La squadra può spendere al massimo 10 $ al giorno, a ogni ora; ogni giorno riparte da capo.');
});

test('the options: few, plain, and no trial of $5 for 30 minutes or night of $5 any more', async () => {
  let options;
  const p = prompter({});
  p.select = async (q) => { options = q.options; return q.initialValue; };
  await promptBudget(p, { t, tf, now: NOW, timeZone: 'Europe/Rome', provider: 'claude' });
  assert.deepEqual(options.map((o) => o.value), ['daily', 'daily_other', 'total', 'custom', 'none']);
  assert.equal(options[0].label, '$10 a day, every day (recommended)');
  assert.ok(!options.some((o) => /30 minutes|8 tomorrow/.test(o.label)), options.map((o) => o.label).join(' | '));
});

test('the recommended amount and the sentence come from one table: changing it changes both', async () => {
  const { BUDGET_SETUP, recommendedDaily, costNote } = await import('../wizard/setup-budget.js');
  assert.deepEqual([recommendedDaily('openai'), recommendedDaily('claude'), recommendedDaily('anthropic'), recommendedDaily('other')], [10, 10, 10, 10]);
  const setup = { ...BUDGET_SETUP, recommendedDailyUsd: { openai: 6 } };
  const p = prompter({});
  const r = await promptBudget(p, { t, tf, now: NOW, timeZone: 'UTC', provider: 'openai', setup });
  assert.equal(r.dailyUsd, 6);
  assert.match(costNote(tf, 'openai', setup), /With \$6 a day the team works at full strength about 40-60 minutes/);
});

test('another amount a day: proposed already written, Enter keeps it, a wrong one is asked again', async () => {
  const keep = await promptBudget(prompter({ [PROMPT]: 'daily_other' }), { t, tf, now: NOW, timeZone: 'UTC', provider: 'openai' });
  assert.equal(keep.dailyUsd, 10);
  const p = prompter({ [PROMPT]: 'daily_other', [en['wizard.budget.daily_amount_prompt']]: ['lots', '4,5'] });
  const r = await promptBudget(p, { t, tf, now: NOW, timeZone: 'UTC', provider: 'openai' });
  assert.deepEqual([r.kind, r.dailyUsd, r.budget], ['daily', 4.5, null]);
  assert.equal(p.asked.filter((a) => a[1] === en['wizard.budget.daily_amount_prompt']).length, 2);
});

test('an amount in all for a period: $20 in 7 days proposed, and $2 for 10 minutes possible', async () => {
  const proposed = await promptBudget(prompter({ [PROMPT]: 'total' }), { t, tf, now: NOW, timeZone: 'Europe/Rome' });
  assert.deepEqual([proposed.kind, proposed.budget.usd, proposed.budget.duration_minutes, proposed.dailyUsd], ['days', 20, 7 * 24 * 60, null]);
  const small = await promptBudget(prompter({ [PROMPT]: 'total', 'How many dollars in total?': ['2'], [en['wizard.budget.period_prompt']]: ['10m'] }),
    { t, tf, now: NOW, timeZone: 'Europe/Rome' });
  assert.deepEqual([small.kind, small.budget.usd, small.budget.duration_minutes], ['trial', 2, 10]);
  assert.equal(budgetSummary(t, tf, small), 'The team can spend $2 in all; the 10 minutes start when the team starts working, then it stops by itself.');
  const until = await promptBudget(prompter({ [PROMPT]: 'total', [en['wizard.budget.period_prompt']]: ['soon', '08:00'] }), { t, tf, now: NOW, timeZone: 'Europe/Rome' });
  assert.deepEqual([until.kind, until.budget.ends_at], ['until', '2026-11-16T07:00:00.000Z']);
});

test('below the least of the service an explicit yes; above 500 once more; a no asks the amount again', async () => {
  const p = prompter({ [PROMPT]: 'total', 'How many dollars in total?': ['2', '1000', '6'], confirm: false });
  const r = await promptBudget(p, { t, tf, now: NOW, timeZone: 'UTC', provider: 'claude' });
  assert.equal(r.budget.usd, 6);
  assert.equal(p.asked.filter((a) => a[0] === 'confirm').length, 2);
  assert.ok(1000 > BUDGET_CONFIRM_ABOVE);
});

test('I set it myself: one question at a time, each with its default; Enter everywhere gives $10 a day at any hour', async () => {
  const p = prompter({ [PROMPT]: 'custom' });
  const r = await promptBudget(p, { t, tf, now: NOW, timeZone: 'UTC', provider: 'openai' });
  assert.deepEqual(r, { kind: 'daily', budget: null, workingHours: null, dailyUsd: 10 });
  assert.deepEqual(p.asked.filter((a) => a[0] !== 'note').map((a) => a[1]), [PROMPT, en['wizard.budget.daily_prompt'], en['wizard.budget.total_ask'], HOURS]);
  assert.equal(p.asked.find((a) => a[1] === HOURS)[2], 'always');
});

test('I set it myself, all of it: a ceiling a day, an amount in all with its period, days and hours of my own', async () => {
  const p = prompter({
    [PROMPT]: 'custom', [en['wizard.budget.daily_prompt']]: ['1.5'], confirm: true, 'How many dollars in total?': ['3'],
    [en['wizard.budget.period_prompt']]: ['15 min'], [HOURS]: 'custom',
    [en['wizard.budget.hours_from_prompt']]: ['21:00'], [en['wizard.budget.hours_to_prompt']]: ['06:00'],
  });
  p.multiselect = async (q) => { p.asked.push(['multiselect', q.message, q.options.map((o) => o.label)]); return ['sat', 'mon']; };
  const r = await promptBudget(p, { t, tf, now: NOW, timeZone: 'Europe/Rome', lang: 'it' });
  assert.deepEqual([r.kind, r.budget.usd, r.budget.duration_minutes, r.dailyUsd], ['trial', 3, 15, 1.5]);
  assert.deepEqual(r.workingHours, { timezone: 'Europe/Rome', windows: [{ days: ['mon', 'sat'], start: '21:00', end: '06:00' }] });
  assert.equal(p.asked.find((a) => a[0] === 'multiselect')[2][0], 'lunedì', 'the days are named in the language of the setup');
  assert.equal(budgetSummary(t, tf, r), 'The team can spend $3 in all; the 15 minutes start when the team starts working, then it stops by itself. At most $1.5 a day.');
  // a ceiling a day only, weekdays 9-18: the line says the days in the language of the setup
  const office = await promptBudget(prompter({ [PROMPT]: 'custom', [HOURS]: 'office' }), { t, tf, now: NOW, timeZone: 'Europe/Rome' });
  assert.equal(budgetSummary(t, tf, { ...office, lang: 'en' }), 'The team can spend at most $10 a day, Mon, Tue, Wed, Thu, Fri from 9:00 to 18:00 (Europe/Rome); every day it starts again.');
  // nothing at all: no ceiling a day and no amount in all is no limit
  const none = await promptBudget(prompter({ [PROMPT]: 'custom', [en['wizard.budget.daily_prompt']]: [''] }), { t, tf, now: NOW, timeZone: 'UTC' });
  assert.deepEqual([none.kind, none.budget, none.dailyUsd], ['none', null, null]);
});

test('with the ChatGPT subscription no question in dollars: a note and the working hours only', async () => {
  const p = prompter({ [HOURS]: 'office' });
  const r = await promptBudget(p, { t, tf, now: NOW, timeZone: 'Europe/Rome', provider: 'openai', authMethod: 'subscription' });
  assert.deepEqual([r.kind, r.budget, r.dailyUsd], ['subscription', null, null]);
  assert.deepEqual(r.workingHours.windows, [{ days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '09:00', end: '18:00' }]);
  assert.deepEqual(p.asked.map((a) => a[0]), ['note', 'select']);
  assert.match(p.asked[0][1], /limits of your plan/);
  assert.match(budgetSummary(t, tf, { ...r, lang: 'en' }), /^ChatGPT subscription: the team follows the limits of your plan .* it works Mon, Tue, Wed, Thu, Fri from 9:00 to 18:00 \(Europe\/Rome\)\.$/);
  // the choice is a parameter: with it on, the subscription is asked the dollars like a key
  const { BUDGET_SETUP } = await import('../wizard/setup-budget.js');
  const asked = await promptBudget(prompter({}), { t, tf, now: NOW, timeZone: 'UTC', provider: 'openai', authMethod: 'subscription', setup: { ...BUDGET_SETUP, subscriptionAsksDollars: true } });
  assert.equal(asked.dailyUsd, 10);
});

test('no limit warns, saves nothing, and asks the working hours of before', async () => {
  const p = prompter({ [PROMPT]: 'none' });
  const r = await promptBudget(p, { t, tf, now: NOW, timeZone: 'Europe/Rome', askHours: async () => 'asked' });
  assert.deepEqual(r, { kind: 'none', budget: null, workingHours: 'asked', dailyUsd: null });
  assert.ok(p.asked.some((a) => a[0] === 'note' && /credit on your account/.test(a[1])));
  assert.match(budgetSummary(t, tf, r), /^No limit/);
});

test('nextLocalHour: the next 8:00 in the zone of the person, today before 8 and tomorrow after', () => {
  assert.equal(nextLocalHour(NOW, 8, 'Europe/Rome').toISOString(), '2026-11-16T07:00:00.000Z');
  assert.equal(nextLocalHour(NOW, 8, 'America/New_York').toISOString(), '2026-11-16T13:00:00.000Z');
  assert.equal(nextLocalHour(new Date('2026-11-16T04:00:00Z'), 8, 'Europe/Rome').toISOString(), '2026-11-16T07:00:00.000Z');
});
