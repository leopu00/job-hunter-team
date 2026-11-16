// The budget step of `jht setup` (cli/wizard/setup-budget.js): the four answers, the amount typed, the night until 8 in the zone of
// the person, and the line that says it. A scripted prompter, a fixed clock; nothing is asked to a person or a provider.
import assert from 'node:assert/strict';
import test from 'node:test';
import { BUDGET_CONFIRM_ABOVE, budgetSummary, nextLocalHour, parseUsd, promptBudget } from '../wizard/setup-budget.js';

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
  assert.deepEqual(r, { kind: 'trial', workingHours: null, budget: { usd: 5, duration_minutes: 30, saved_at: '2026-11-15T21:30:00.000Z', timezone: 'Europe/Rome', set_by: 'setup' } });
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
  assert.deepEqual(r, { kind: 'none', budget: null, workingHours: 'asked' });
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

test('--budget-until takes a whole hour as 8, 08 or 08:00, and refuses 08:30', async () => {
  const { budgetFromOptions } = await import('../wizard/setup-budget.js');
  for (const hour of ['8', '08', '08:00']) {
    assert.equal(budgetFromOptions({ budgetUsd: '5', budgetUntil: hour }, { now: NOW, timeZone: 'Europe/Rome' }).budget.ends_at, '2026-11-16T07:00:00.000Z', hour);
  }
  assert.ok(budgetFromOptions({ budgetUsd: '5', budgetUntil: '08:30' }, { now: NOW, timeZone: 'Europe/Rome' }).error);
});

test('the same duration budget saved again keeps its period (jht setup --reset must not restart it); another one starts again', async () => {
  const { keepSamePeriod, durationBudget } = await import('../wizard/setup-budget.js');
  const before = durationBudget(5, 30, new Date('2026-11-15T21:30:00Z'), 'Europe/Rome');
  const later = new Date('2026-11-16T07:00:00Z');
  assert.deepEqual(keepSamePeriod(before, durationBudget(5, 30, later, 'Europe/Rome')), before);
  for (const other of [durationBudget(10, 30, later, 'Europe/Rome'), durationBudget(5, 60, later, 'Europe/Rome'), durationBudget(5, 30, later, 'Europe/London')]) {
    assert.equal(keepSamePeriod(before, other).saved_at, later.toISOString(), 'a changed budget starts from now');
  }
  assert.equal(keepSamePeriod(undefined, durationBudget(5, 30, later, 'Europe/Rome')).saved_at, later.toISOString());
  const night = { usd: 5, starts_at: '2026-11-15T21:30:00.000Z', ends_at: '2026-11-16T07:00:00.000Z', timezone: 'Europe/Rome', set_by: 'setup' };
  assert.equal(keepSamePeriod(night, night), night, 'fixed hours are left as they are');
});
