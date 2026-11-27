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

test('the trial is the answer already chosen: $5 for 30 minutes that start when the team starts working, not at the setup, 24/7', async () => {
  const p = prompter({});
  const r = await promptBudget(p, { t, tf, now: NOW, timeZone: 'Europe/Rome' });
  assert.equal(p.asked[0][2], 'trial');
  assert.deepEqual(r, { kind: 'trial', workingHours: null, dailyUsd: null, budget: { usd: 5, duration_minutes: 30, saved_at: '2026-11-15T21:30:00.000Z', timezone: 'Europe/Rome', set_by: 'setup' } });
  assert.equal('starts_at' in r.budget || 'ends_at' in r.budget, false, 'the period is fixed by the brake at the first work of the team');
  assert.equal(budgetSummary(t, tf, r), 'The team can spend $5 in all; the 30 minutes start when the team starts working, then it stops by itself.');
});

test('one night ends at 8 tomorrow in the zone of the person, not in the zone of the computer', async () => {
  const r = await promptBudget(prompter({ 'How much should the team work?': 'night' }), { t, tf, now: NOW, timeZone: 'Europe/Rome' });
  assert.equal(r.budget.ends_at, '2026-11-16T07:00:00.000Z');
  assert.equal(budgetSummary(t, tf, r), 'The team can spend $5 until 8:00 (Europe/Rome), then it stops by itself.');
  const ny = await promptBudget(prompter({ 'How much should the team work?': 'night' }), { t, tf, now: NOW, timeZone: 'America/New_York' });
  assert.equal(ny.budget.ends_at, '2026-11-16T13:00:00.000Z', '16:30 in New York: 8 tomorrow is 15.5 hours away');
  // before 8 in the morning the night ends at 8 of the same day
  assert.equal(nextLocalHour(new Date('2026-11-16T04:00:00Z'), 8, 'Europe/Rome').toISOString(), '2026-11-16T07:00:00.000Z');
});

test('a few days: the amount typed (a wrong one asked again), the days and the hours; the line of the order', async () => {
  const p = prompter({ 'How much should the team work?': 'days', 'How many dollars in total?': ['ten', '10'], 'For how many days?': 3, 'When does it work?': 'ten_from_8' });
  const r = await promptBudget(p, { t, tf, now: NOW, timeZone: 'Europe/Rome' });
  assert.equal(r.budget.usd, 10);
  assert.deepEqual([r.budget.duration_minutes, r.budget.saved_at, r.budget.ends_at], [3 * 24 * 60, '2026-11-15T21:30:00.000Z', undefined]);
  assert.deepEqual(r.workingHours, { timezone: 'Europe/Rome', windows: [{ days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], start: '08:00', end: '18:00' }] });
  assert.equal(p.asked.filter((a) => a[1] === 'How many dollars in total?').length, 2);
  assert.equal(budgetSummary(t, tf, r), 'The team can spend $10 in all, for 3 days from when it starts working, 10 hours a day (8:00-18:00 Europe/Rome), then it stops by itself.');
  const i = catalog(it);
  assert.equal(budgetSummary(i.t, i.tf, r), 'La squadra può spendere 10 $ in tutto, per 3 giorni da quando comincia a lavorare, 10 ore al giorno (8:00-18:00 Europe/Rome), poi si ferma da sola.');
});

test('an amount above the threshold is asked once more; a no asks the amount again', async () => {
  const p = prompter({ 'How much should the team work?': 'days', 'How many dollars in total?': ['1000', '20'], confirm: false });
  const r = await promptBudget(p, { t, tf, now: NOW, timeZone: 'Europe/Rome' });
  assert.equal(r.budget.usd, 20);
  assert.equal(p.asked.filter((a) => a[0] === 'confirm').length, 1);
  assert.ok(1000 > BUDGET_CONFIRM_ABOVE);
});

test('no limit warns, saves no budget, and asks the working hours of before', async () => {
  const p = prompter({ 'How much should the team work?': 'none' });
  const r = await promptBudget(p, { t, tf, now: NOW, timeZone: 'Europe/Rome', askHours: async () => 'asked' });
  assert.deepEqual(r, { kind: 'none', budget: null, workingHours: 'asked', dailyUsd: null });
  assert.ok(p.asked.some((a) => a[0] === 'note' && /credit on your account/.test(a[1])));
  assert.match(budgetSummary(t, tf, r), /^No limit/);
});

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

test('below the least that lets a team work on the service the setup asks an explicit yes; a no asks the amount again', async () => {
  const { minimumFor } = await import('../wizard/setup-budget.js');
  assert.deepEqual(['glm', 'kimi', 'openai', 'claude', 'anthropic', 'moonshot', 'other'].map(minimumFor), [2, 2, 5, 5, 5, 2, 0]);
  const p = prompter({ 'How much should the team work?': 'days', 'How many dollars in total?': ['2', '6'], confirm: false });
  const r = await promptBudget(p, { t, tf, now: NOW, timeZone: 'Europe/Rome', provider: 'claude' });
  assert.equal(r.budget.usd, 6, 'the $2 was not kept on Claude: the amount was asked again');
  assert.equal(p.asked.filter((a) => a[0] === 'confirm').length, 1);
  assert.match(p.asked.find((a) => a[0] === 'confirm')[1], /^\$2 is below the least that lets a team do some work on this service \(\$5\)/);
  // the same $2 on GLM is enough: no question
  const glm = prompter({ 'How much should the team work?': 'days', 'How many dollars in total?': ['2'] });
  assert.equal((await promptBudget(glm, { t, tf, now: NOW, timeZone: 'Europe/Rome', provider: 'glm' })).budget.usd, 2);
  assert.equal(glm.asked.filter((a) => a[0] === 'confirm').length, 0);
  // the trial of $5 and an answer of «yes» are never stopped
  const yes = prompter({ 'How much should the team work?': 'days', 'How many dollars in total?': ['3'], confirm: true });
  assert.equal((await promptBudget(yes, { t, tf, now: NOW, timeZone: 'Europe/Rome', provider: 'openai' })).budget.usd, 3);
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

test('the ready answers propose amount and period, Enter keeps them, and the person can change them: $2 for 10 minutes', async () => {
  const p = prompter({ 'How many dollars in total?': ['2'], [en['wizard.budget.period_prompt']]: ['10m'], confirm: true });
  const r = await promptBudget(p, { t, tf, now: NOW, timeZone: 'Europe/Rome' });
  assert.deepEqual([r.kind, r.budget.usd, r.budget.duration_minutes, r.dailyUsd, r.workingHours], ['trial', 2, 10, null, null]);
  const texts = p.asked.filter((a) => a[0] === 'text').map((a) => a[1]);
  assert.deepEqual(texts, ['How many dollars in total?', en['wizard.budget.period_prompt']]);
  assert.equal(budgetSummary(t, tf, r), 'The team can spend $2 in all; the 10 minutes start when the team starts working, then it stops by itself.');
  // the night proposes 08:00 and takes another time of the day
  const night = await promptBudget(prompter({ 'How much should the team work?': 'night', [en['wizard.budget.period_prompt']]: ['06:30'] }), { t, tf, now: NOW, timeZone: 'Europe/Rome' });
  assert.deepEqual([night.kind, night.budget.ends_at], ['night', '2026-11-16T05:30:00.000Z']);
});

test('a period typed wrong is asked again; a few days keeps its hours', async () => {
  const p = prompter({ 'How much should the team work?': 'days', [en['wizard.budget.period_prompt']]: ['soon', '5d'] });
  const r = await promptBudget(p, { t, tf, now: NOW, timeZone: 'Europe/Rome' });
  assert.deepEqual([r.kind, r.budget.usd, r.budget.duration_minutes], ['days', 10, 5 * 24 * 60]);
  assert.equal(p.asked.filter((a) => a[1] === en['wizard.budget.period_prompt']).length, 2);
  assert.ok(r.workingHours.windows[0].start === '08:00');
});

test('custom: the amount, the period, a ceiling per day and days and hours of the person\'s choice', async () => {
  const p = prompter({
    'How much should the team work?': 'custom', 'How many dollars in total?': ['3'], [en['wizard.budget.period_prompt']]: ['15 min'],
    [en['wizard.budget.daily_prompt']]: ['1.5'], 'When does it work?': 'custom',
    [en['wizard.budget.hours_from_prompt']]: ['21:00'], [en['wizard.budget.hours_to_prompt']]: ['06:00'], confirm: true,
  });
  p.multiselect = async (q) => { p.asked.push(['multiselect', q.message, q.options.map((o) => o.label)]); return ['sat', 'mon']; };
  const r = await promptBudget(p, { t, tf, now: NOW, timeZone: 'Europe/Rome', lang: 'it' });
  assert.deepEqual([r.kind, r.budget.usd, r.budget.duration_minutes, r.dailyUsd], ['trial', 3, 15, 1.5]);
  assert.deepEqual(r.workingHours, { timezone: 'Europe/Rome', windows: [{ days: ['mon', 'sat'], start: '21:00', end: '06:00' }] });
  assert.equal(p.asked.find((a) => a[0] === 'multiselect')[2][0], 'lunedì', 'the days are named in the language of the setup');
  assert.equal(budgetSummary(t, tf, r), 'The team can spend $3 in all; the 15 minutes start when the team starts working, then it stops by itself. At most $1.5 a day.');
  // no ceiling: an empty answer
  const none = prompter({ 'How much should the team work?': 'custom', [en['wizard.budget.daily_prompt']]: [''], 'When does it work?': 'always', confirm: true });
  const r2 = await promptBudget(none, { t, tf, now: NOW, timeZone: 'Europe/Rome' });
  assert.deepEqual([r2.dailyUsd, r2.workingHours, r2.budget.usd, r2.budget.duration_minutes], [null, null, 5, 60]);
});

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
