/**
 * The budget step of `jht setup`: how much the team may spend, for how long, and when it works (JHT-T322).
 *
 * One question with ready answers for a person who has never set a budget («a trial: $5 for 30 minutes», «one night»,
 * «a few days», «no limit»), and three short ones only for «a few days». What it returns is saved next to
 * team.working_hours as team.budget: { usd, duration_minutes, saved_at, timezone, set_by } for a trial or a few days (the period
 * starts at the first work of the team, not at the setup), { usd, starts_at, ends_at, timezone, set_by } for one night (fixed
 * hours); ISO instants in UTC. The brake of the pi harness (shared/skills/pi_spend_cap.py) counts what pi spends from the setup
 * and pauses the team, in a declared way, when
 * the budget or the period is over, or when it goes faster than the budget spread over the working minutes of the period.
 * Dollars: pi measures the cost in dollars and the four providers charge in dollars.
 */
import { localTimeZone } from '../src/lib/local-tz.js';

const ALL_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const MINUTE = 60_000;

/** The ready answers: what each one saves. Minutes of period, or `until` a local hour; hours null = 24/7. */
export const BUDGET_PRESETS = Object.freeze({
  trial: Object.freeze({ usd: 5, minutes: 30, hours: null }),
  night: Object.freeze({ usd: 5, untilHour: 8, hours: null }),
});

/** The working hours «a few days» offers, as team.working_hours windows (null = 24/7). */
export const HOURS_PRESETS = Object.freeze({
  ten_from_8: Object.freeze({ days: ALL_DAYS, start: '08:00', end: '18:00' }),
  daytime: Object.freeze({ days: ALL_DAYS, start: '09:00', end: '18:00' }),
  office: Object.freeze({ days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '09:00', end: '18:00' }),
  night: Object.freeze({ days: ALL_DAYS, start: '22:00', end: '07:00' }),
  always: null,
});

export const BUDGET_DAYS = Object.freeze([1, 3, 7, 14, 30]);
/**
 * The least that lets a team do some work on each service: the Assistente's onboarding and the Capitano's first rounds come before
 * the Scouts (a trial on Claude spent $1.7 of $2 before the first search). Below it the setup asks for an explicit yes.
 */
export const BUDGET_MIN_USD = Object.freeze({ glm: 2, kimi: 2, openai: 5, claude: 5 });
const PROVIDER_NAMES = Object.freeze({ anthropic: 'claude', moonshot: 'kimi' });

/** The recommended minimum for a provider (by any name the config uses), or 0 when the setup knows none. */
export function minimumFor(provider) {
  const name = String(provider ?? '').trim().toLowerCase();
  return BUDGET_MIN_USD[PROVIDER_NAMES[name] ?? name] ?? 0;
}
/** Above this the person is asked once more: a typo of a zero is a lot of money. */
export const BUDGET_CONFIRM_ABOVE = 500;

/** The wall-clock hour and minute of `now` in `timeZone` (the zone the team works in). */
function localClock(now, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(now).filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]));
  return { hour: parts.hour, minute: parts.minute };
}

/** The instant of the next `hour`:00 in `timeZone` after `now` (today if it is still ahead, else tomorrow). */
export function nextLocalHour(now, hour, timeZone) {
  const { hour: h, minute: m } = localClock(now, timeZone);
  let minutes = hour * 60 - (h * 60 + m);
  if (minutes <= 0) minutes += 24 * 60;
  const at = new Date(now.getTime() + minutes * MINUTE);
  at.setUTCSeconds(0, 0);
  return at;
}

/** A positive amount of dollars from what the person typed («10», «7.5», «7,5», «$10»), or null. */
export function parseUsd(text) {
  const clean = String(text ?? '').trim().replace(/^\$\s*/, '').replace(/\s*(\$|usd|dollars?)$/i, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const value = Number(clean);
  return value > 0 ? value : null;
}

/** team.budget for an amount and a period at fixed hours (one night until 8, --budget-until): it starts now and ends at
 * `endsAt`; the zone of the person goes with it (the brake says «resumes at HH:MM» in it). */
export function budgetOf(usd, endsAt, now, timeZone = localTimeZone()) {
  return { usd, starts_at: now.toISOString(), ends_at: endsAt.toISOString(), timezone: timeZone, set_by: 'setup' };
}

/**
 * team.budget for an amount and a DURATION (the trial of 30 minutes, a few days, --budget-minutes, --budget-days): the period
 * does not start at the setup, which the onboarding and the first pull of the image would eat, but at the first work of an
 * agent of the team. The brake fixes that moment ($JHT_HOME/state/budget-start.json); the dollars count from saved_at.
 */
export function durationBudget(usd, minutes, now, timeZone = localTimeZone()) {
  return { usd, duration_minutes: minutes, saved_at: now.toISOString(), timezone: timeZone, set_by: 'setup' };
}

/** The length of the period in minutes: the duration given, or ends_at − starts_at. */
export function budgetMinutes(budget) {
  if (Number.isFinite(Number(budget?.duration_minutes))) return Number(budget.duration_minutes);
  return Math.round((Date.parse(budget.ends_at) - Date.parse(budget.starts_at)) / MINUTE);
}

function windowsOf(hours, timeZone) {
  return hours ? { timezone: timeZone, windows: [{ days: [...hours.days], start: hours.start, end: hours.end }] } : null;
}

const clock = (hhmm) => hhmm.replace(/^0(\d)/, '$1');

function workedHoursPerDay(window) {
  const [sh, sm] = window.start.split(':').map(Number);
  const [eh, em] = window.end.split(':').map(Number);
  let minutes = eh * 60 + em - (sh * 60 + sm);
  if (minutes <= 0) minutes += 24 * 60;
  return Math.round(minutes / 6) / 10;
}

/**
 * The one line said before the configuration is saved, in words a person reads once: «The team can spend $10 in 3 days,
 * 10 hours a day (8:00-18:00 Europe/Rome), then it stops by itself.» `kind` = trial | night | days | none (what was chosen).
 */
export function budgetSummary(t, tf, { budget, workingHours, kind }) {
  if (!budget) return t('wizard.budget.summary_none');
  const money = tf('wizard.budget.money', String(budget.usd));
  const zone = budget.timezone || workingHours?.timezone || localTimeZone();
  const minutes = budgetMinutes(budget);
  if (kind === 'night' || kind === 'until') {
    const at = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(budget.ends_at));
    return tf('wizard.budget.summary_until', money, clock(at), zone);
  }
  if (minutes < 24 * 60 || minutes % (24 * 60) !== 0) return tf('wizard.budget.summary_minutes', money, String(minutes));
  const days = minutes / (24 * 60);
  const period = tf(days === 1 ? 'wizard.budget.day_one' : 'wizard.budget.day_many', String(days));
  const w = workingHours?.windows?.[0];
  if (!w) return tf('wizard.budget.summary_days_always', money, period);
  const perDay = tf(w.days.length === 7 ? 'wizard.budget.per_day' : 'wizard.budget.per_weekday', String(workedHoursPerDay(w)));
  return tf('wizard.budget.summary_days', money, period, perDay, `${clock(w.start)}-${clock(w.end)}`, zone);
}

/**
 * Asks the budget. Returns { kind, budget, workingHours } (kind = trial | night | days | none): budget null = no limit (nothing saved under team.budget);
 * workingHours null = 24/7, undefined = keep what the config has (the «no limit» answer asks the hours as before).
 * @param {{ t: Function, tf: Function, now?: Date, timeZone?: string, askHours?: Function }} params askHours = the hours step of
 *   before (promptWorkingHours), asked only with «no limit»
 */
export async function promptBudget(prompter, { t, tf, now = new Date(), timeZone = localTimeZone(), askHours = async () => undefined, provider = '' }) {
  const choice = await prompter.select({
    message: t('wizard.budget.prompt'),
    initialValue: 'trial',
    options: [
      { value: 'trial', label: t('wizard.budget.trial') },
      { value: 'night', label: t('wizard.budget.night') },
      { value: 'days', label: t('wizard.budget.days') },
      { value: 'none', label: t('wizard.budget.none') },
    ],
  });
  if (choice === 'trial') {
    const p = BUDGET_PRESETS.trial;
    return { kind: 'trial', budget: durationBudget(p.usd, p.minutes, now, timeZone), workingHours: null };
  }
  if (choice === 'night') {
    const p = BUDGET_PRESETS.night;
    return { kind: 'night', budget: budgetOf(p.usd, nextLocalHour(now, p.untilHour, timeZone), now, timeZone), workingHours: null };
  }
  if (choice === 'none') {
    await prompter.note(t('wizard.budget.none_warning'), t('wizard.budget.title'));
    return { kind: 'none', budget: null, workingHours: await askHours() };
  }
  // «a few days»: how much, for how many days, when
  let usd = null;
  while (usd === null) {
    const typed = await prompter.text({
      message: t('wizard.budget.amount_prompt'),
      initialValue: '10',
      validate: (value) => (parseUsd(value) === null ? t('wizard.budget.amount_invalid') : undefined),
    });
    // nothing typed = the amount already written in the box
    usd = parseUsd(String(typed ?? '').trim() === '' ? '10' : typed);
    if (usd === null) { await prompter.note(t('wizard.budget.amount_invalid'), t('wizard.budget.title')); continue; }
    if (usd > BUDGET_CONFIRM_ABOVE && !(await prompter.confirm({ message: tf('wizard.budget.amount_confirm', `$${usd}`), initialValue: false }))) usd = null;
    const least = minimumFor(provider);
    if (usd !== null && usd < least && !(await prompter.confirm({ message: tf('wizard.budget.below_min', `$${usd}`, `$${least}`, `$${usd}`), initialValue: false }))) usd = null;
  }
  const days = await prompter.select({
    message: t('wizard.budget.days_prompt'),
    initialValue: 3,
    options: BUDGET_DAYS.map((n) => ({ value: n, label: tf(n === 1 ? 'wizard.budget.day_one' : 'wizard.budget.day_many', String(n)) })),
  });
  const hoursChoice = await prompter.select({
    message: t('wizard.budget.hours_prompt'),
    initialValue: 'ten_from_8',
    options: Object.keys(HOURS_PRESETS).map((key) => ({ value: key, label: t(`wizard.budget.hours_${key}`) })),
  });
  return {
    kind: 'days',
    budget: durationBudget(usd, Number(days) * 24 * 60, now, timeZone),
    workingHours: windowsOf(HOURS_PRESETS[hoursChoice] ?? null, timeZone),
  };
}

/**
 * The budget of `jht setup --non-interactive`: --budget-usd with one of --budget-minutes, --budget-days or --budget-until HH,
 * or --no-budget. Returns { kind, budget } (kind as budgetSummary reads it) or { error } (a sentence), or {} when nothing about the budget was given.
 */
export function budgetFromOptions(opts, { now = new Date(), timeZone = localTimeZone() } = {}) {
  if (opts.budget === false) return { kind: 'none', budget: null };
  if (opts.budgetUsd === undefined) {
    return opts.budgetMinutes || opts.budgetDays || opts.budgetUntil ? { error: 'Give the amount with --budget-usd <dollars>.' } : {};
  }
  const usd = parseUsd(opts.budgetUsd);
  if (usd === null) return { error: '--budget-usd must be a positive amount of dollars, for example 10 or 7.5.' };
  const given = ['budgetMinutes', 'budgetDays', 'budgetUntil'].filter((k) => opts[k] !== undefined);
  if (given.length !== 1) return { error: 'Give the period with one of --budget-minutes <n>, --budget-days <n> or --budget-until <hour 0-23>.' };
  // --budget-until takes the hour as 8, 08 or 08:00 (a whole hour: the night ends on the hour)
  const n = Number(given[0] === 'budgetUntil' ? String(opts.budgetUntil).trim().replace(/^(\d{1,2}):00$/, '$1') : opts[given[0]]);
  if (given[0] === 'budgetUntil') {
    if (!Number.isInteger(n) || n < 0 || n > 23) return { error: '--budget-until is a whole hour of the day, 0 to 23 (8 or 08:00).' };
    return { kind: 'until', budget: budgetOf(usd, nextLocalHour(now, n, timeZone), now, timeZone) };
  }
  if (!Number.isFinite(n) || n <= 0) return { error: `--${given[0] === 'budgetDays' ? 'budget-days' : 'budget-minutes'} must be a positive number.` };
  const minutes = given[0] === 'budgetDays' ? n * 24 * 60 : n;
  return { kind: given[0] === 'budgetDays' ? 'days' : 'trial', budget: durationBudget(usd, minutes, now, timeZone) };
}
