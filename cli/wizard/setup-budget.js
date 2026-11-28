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
 * The choices of the budget step that the person in charge may change (JHT-T345b), in one place:
 *   recommendedDailyUsd  the answer already chosen («$10 a day, every day»), per provider; fallbackDailyUsd for the others;
 *   halfHourUsd          what half an hour of the full team costs (measured on our benches), said next to the question;
 *   onboardingUsd        what the onboarding of the first day costs;
 *   totalProposal        what «an amount in all, for a period» proposes;
 *   subscriptionAsksDollars  with a subscription the plan paces the team: no question in dollars unless this is true;
 *   hoursDefault         the working hours already chosen when they are asked.
 * The pace of the ceiling per day (spreading it over the day) is not here yet: a work of its own.
 */
export const BUDGET_SETUP = Object.freeze({
  recommendedDailyUsd: Object.freeze({ openai: 10, claude: 10 }),
  fallbackDailyUsd: 10,
  halfHourUsd: Object.freeze({ openai: Object.freeze([3, 5]), claude: Object.freeze([3, 5]) }),
  fallbackHalfHourUsd: Object.freeze([3, 5]),
  onboardingUsd: Object.freeze([1, 2]),
  totalProposal: Object.freeze({ usd: '20', period: '7d' }),
  subscriptionAsksDollars: false,
  hoursDefault: 'always',
});
const PROVIDER_LABELS = Object.freeze({ openai: 'OpenAI', claude: 'Anthropic' });
const canonicalProvider = (provider) => {
  const name = String(provider ?? '').trim().toLowerCase();
  return PROVIDER_NAMES[name] ?? name;
};

/** The ceiling per day already chosen for a provider. */
export function recommendedDaily(provider, setup = BUDGET_SETUP) {
  return setup.recommendedDailyUsd[canonicalProvider(provider)] ?? setup.fallbackDailyUsd;
}

/** The sentence above the question: who is paid, what the recommended amount buys, what the first day costs. */
export function costNote(tf, provider, setup = BUDGET_SETUP) {
  const name = canonicalProvider(provider);
  const daily = recommendedDaily(provider, setup);
  const [low, high] = setup.halfHourUsd[name] ?? setup.fallbackHalfHourUsd;
  const round10 = (minutes) => Math.max(10, Math.round(minutes / 10) * 10);
  const [first, second] = setup.onboardingUsd;
  const money = (value) => tf('wizard.budget.money', String(value));
  return tf('wizard.budget.cost_note', PROVIDER_LABELS[name] ?? name, money(daily), String(round10((daily / high) * 30)),
    String(round10((daily / low) * 30)), money(`${low}-${high}`), money(`${first}-${second}`));
}
/**
 * The least that lets a team do some work on each service: the Assistente's onboarding and the Capitano's first rounds come before
 * the Scouts (a trial on Claude spent $1.7 of $2 before the first search). Below it the setup asks for an explicit yes.
 */
export const BUDGET_MIN_USD = Object.freeze({ glm: 2, kimi: 2, openai: 5, claude: 5 });
const PROVIDER_NAMES = Object.freeze({ anthropic: 'claude', moonshot: 'kimi' });
// (BUDGET_SETUP below reads the names through this table)

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

/** The instant of the next `hour`:`minute` in `timeZone` after `now` (today if it is still ahead, else tomorrow). */
export function nextLocalTime(now, hour, minute, timeZone) {
  const { hour: h, minute: m } = localClock(now, timeZone);
  let minutes = hour * 60 + minute - (h * 60 + m);
  if (minutes <= 0) minutes += 24 * 60;
  const at = new Date(now.getTime() + minutes * MINUTE);
  at.setUTCSeconds(0, 0);
  return at;
}

/** The instant of the next `hour`:00 in `timeZone` after `now`. */
export function nextLocalHour(now, hour, timeZone) {
  return nextLocalTime(now, hour, 0, timeZone);
}

const UNIT_MINUTES = [
  [/^(m|min|mins|minutes?|minut[oi]|minuten?|minutos?|perc)$/, 1],
  [/^(h|hr|hrs|hours?|or[ae]|stunden?|horas?|heures?|óra)$/, 60],
  [/^(d|g|days?|giorn[oi]|tage?|d[ií]as?|jours?|nap)$/, 24 * 60],
];

/**
 * A period typed by the person (JHT-T345): a duration («30», «30m», «15 min», «2h», «1.5h», «3d», «3 giorni»; a bare
 * number is minutes) as { minutes }, or a time of the day («18:30», «8», «until 8:00») as { until: { hour, minute } }, the
 * next one. Null for anything else.
 */
export function parseDuration(text) {
  const s = String(text ?? '').trim().toLowerCase().replace(',', '.');
  const at = /^(?:\D*\s)?(\d{1,2})(?::(\d{2}))$/.exec(s) ?? /^(?:until|fino alle|bis|hasta|jusqu'à|até)\s+(\d{1,2})(?::(\d{2}))?$/.exec(s);
  if (at) {
    const hour = Number(at[1]); const minute = Number(at[2] ?? 0);
    return hour <= 23 && minute <= 59 ? { until: { hour, minute } } : null;
  }
  const d = /^(\d+(?:\.\d+)?)\s*([^\d\s.]*)$/.exec(s);
  if (!d) return null;
  const amount = Number(d[1]);
  const unit = d[2] === '' ? 1 : UNIT_MINUTES.find(([re]) => re.test(d[2]))?.[1];
  if (!unit || !(amount > 0)) return null;
  const minutes = Math.round(amount * unit);
  return minutes >= 1 ? { minutes } : null;
}

/** A time of the day «HH:MM» (or «H:MM») as «HH:MM», or null. */
export function parseClock(text) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(text ?? '').trim());
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

/** The days of the working hours from «mon-fri», «sat,sun», «all»: an array of mon..sun, or null. */
export function parseWorkDays(spec) {
  const s = String(spec ?? '').trim().toLowerCase();
  if (s === 'all' || s === 'every-day') return [...ALL_DAYS];
  if (/^[a-z]{3}-[a-z]{3}$/.test(s)) {
    const [a, b] = s.split('-').map((d) => ALL_DAYS.indexOf(d));
    return a >= 0 && b >= 0 && a <= b ? ALL_DAYS.slice(a, b + 1) : null;
  }
  const list = s.split(',').map((d) => d.trim()).filter(Boolean);
  return list.length && list.every((d) => ALL_DAYS.includes(d)) ? ALL_DAYS.filter((d) => list.includes(d)) : null;
}

/** «09:00-18:00» as { start, end } (an end before the start runs past midnight), or null; never a window of nothing. */
export function parseWorkTime(spec) {
  const [a, b, extra] = String(spec ?? '').split('-').map((x) => x.trim());
  const start = parseClock(a); const end = parseClock(b);
  return start && end && extra === undefined && start !== end ? { start, end } : null;
}

/** team.working_hours with one window, in the zone of the person. */
export function workingHoursOf(days, start, end, timeZone = localTimeZone()) {
  return { timezone: timeZone, windows: [{ days: [...days], start, end }] };
}

/** The budget of an amount and a period as parseDuration reads it: a time of the day ends there, a duration starts at the
 * first work of the team. `kind` is what budgetSummary reads. */
export function budgetForPeriod(usd, period, now, timeZone = localTimeZone()) {
  if (period.until) {
    return { kind: 'until', budget: budgetOf(usd, nextLocalTime(now, period.until.hour, period.until.minute, timeZone), now, timeZone) };
  }
  const kind = period.minutes >= 24 * 60 && period.minutes % (24 * 60) === 0 ? 'days' : 'trial';
  return { kind, budget: durationBudget(usd, period.minutes, now, timeZone) };
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

/**
 * The budget as it is saved: its moment is the one of the CONFIRMATION, not of the question. The person may take minutes
 * between the two (the summary, a confirmation of a small amount): a trial of 30 minutes whose dollars count from the moment the
 * question appeared lost those minutes before the team started. A duration counts its dollars from `saved_at`; a night starts now
 * (and keeps its end, unless the end is already past).
 */
export function stampedAt(budget, now = new Date()) {
  if (!budget || Number.isNaN(now.getTime())) return budget;
  if (Number.isFinite(Number(budget.duration_minutes))) return { ...budget, saved_at: now.toISOString() };
  if (Date.parse(budget.ends_at) > now.getTime()) return { ...budget, starts_at: now.toISOString() };
  return budget;
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
export function budgetSummary(t, tf, { budget, workingHours, kind, dailyUsd = null, lang = 'en' }) {
  if (kind === 'subscription') return tf('wizard.budget.summary_subscription', whenText(t, tf, workingHours, lang));
  if (!budget && dailyUsd) {
    return tf('wizard.budget.summary_daily', tf('wizard.budget.money', String(dailyUsd)), whenText(t, tf, workingHours, lang));
  }
  const daily = dailyUsd ? ` ${tf('wizard.budget.daily_note', tf('wizard.budget.money', String(dailyUsd)))}` : '';
  return periodSummary(t, tf, { budget, workingHours, kind }) + (budget ? daily : '');
}

/** «at any hour», or «on Mon, Tue, Wed from 9:00 to 18:00 (Europe/Rome)» with the days named in the language of the setup. */
function whenText(t, tf, workingHours, lang) {
  const w = workingHours?.windows?.[0];
  if (!w) return t('wizard.budget.when_always');
  const days = w.days.length === 7 ? t('wizard.budget.when_every_day') : w.days.map((d) => dayLabel(d, lang, 'short')).join(', ');
  return tf('wizard.budget.when_window', days, clock(w.start), clock(w.end), workingHours.timezone || 'UTC');
}

function periodSummary(t, tf, { budget, workingHours, kind }) {
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
 * What the one line above does not say. With the pace ASKED FOR (`budget.pace`) and a period over an hour the brake spaces the
 * spending (a first burst of about a quarter of what the onboarding left, the rest over the time), so the team can pause before the
 * whole amount is spent. Without it (the default) the team works until the budget of the period is spent and stops until the period
 * ends: the note says so. Null when there is no budget or the period is an hour or less (the whole amount is allowed at once then).
 */
export function budgetPaceNote(t, { budget }) {
  if (!budget || budgetMinutes(budget) <= 60) return null;
  return t(budget.pace === true ? 'wizard.budget.pace_note' : 'wizard.budget.pace_off_note');
}

/** The question of the pace, asked after the budget when its period is over an hour: yes = team.budget.pace true. Default no. */
export async function askPace(prompter, { t, budget }) {
  if (!budget || budgetMinutes(budget) <= 60) return budget;
  const on = await prompter.confirm({ message: t('wizard.budget.pace_ask'), initialValue: false });
  return on === true ? { ...budget, pace: true } : budget;
}

/** The amount, asked with `initial` already written (Enter keeps it): a wrong one, a huge one not confirmed or one below the
 * least of the service not confirmed is asked again. */
async function askAmount(prompter, { t, tf, provider, initial }) {
  for (;;) {
    const typed = await prompter.text({
      message: t('wizard.budget.amount_prompt'),
      initialValue: initial,
      validate: (value) => (parseUsd(value) === null ? t('wizard.budget.amount_invalid') : undefined),
    });
    // nothing typed = the amount already written in the box
    const usd = parseUsd(String(typed ?? '').trim() === '' ? initial : typed);
    if (usd === null) { await prompter.note(t('wizard.budget.amount_invalid'), t('wizard.budget.title')); continue; }
    if (usd > BUDGET_CONFIRM_ABOVE && !(await prompter.confirm({ message: tf('wizard.budget.amount_confirm', `$${usd}`), initialValue: false }))) continue;
    const least = minimumFor(provider);
    if (usd < least && !(await prompter.confirm({ message: tf('wizard.budget.below_min', `$${usd}`, `$${least}`, `$${usd}`), initialValue: false }))) continue;
    return usd;
  }
}

/** The period, asked with `initial` already written: «30m», «2h», «3d» or a time of the day such as «18:30». */
async function askPeriod(prompter, { t, initial }) {
  for (;;) {
    const typed = await prompter.text({
      message: t('wizard.budget.period_prompt'),
      initialValue: initial,
      validate: (value) => (parseDuration(value) === null ? t('wizard.budget.period_invalid') : undefined),
    });
    const period = parseDuration(String(typed ?? '').trim() === '' ? initial : typed);
    if (period) return period;
    await prompter.note(t('wizard.budget.period_invalid'), t('wizard.budget.title'));
  }
}

/** The daily ceiling, optional: empty = none. Saved as no_quota_cap.usd, the ceiling the brake of pi already applies. */
async function askDaily(prompter, { t, initial = '', message = 'wizard.budget.daily_prompt', required = false }) {
  for (;;) {
    const typed = String((await prompter.text({ message: t(message), initialValue: initial })) ?? '').trim();
    if (typed === '' && !required) return null;
    if (typed === '' && initial) return parseUsd(initial);
    const usd = parseUsd(typed);
    if (usd !== null) return usd;
    await prompter.note(t('wizard.budget.amount_invalid'), t('wizard.budget.title'));
  }
}

/** The names of the days in the language of the setup, from the system's own calendar (2026-11-16 is a Monday). */
function dayLabel(day, lang, width = 'long') {
  const monday = Date.UTC(2026, 10, 16, 12);
  try {
    return new Intl.DateTimeFormat(lang, { weekday: width, timeZone: 'UTC' }).format(new Date(monday + ALL_DAYS.indexOf(day) * 86_400_000));
  } catch { return day; }
}

/** When the team works: one of the ready windows, or days and hours of the person's own (JHT-T345). */
const HOURS_OFFERED = Object.freeze(['always', 'office', 'ten_from_8', 'night', 'custom']);

async function askHours(prompter, { t, timeZone, lang, initial = BUDGET_SETUP.hoursDefault }) {
  const choice = await prompter.select({
    message: t('wizard.budget.hours_prompt'),
    initialValue: initial,
    options: HOURS_OFFERED.map((key) => ({ value: key, label: t(`wizard.budget.hours_${key}`) })),
  });
  if (choice !== 'custom') return windowsOf(HOURS_PRESETS[choice] ?? null, timeZone);
  let days = [];
  while (!days.length) {
    days = (await prompter.multiselect({
      message: t('wizard.budget.hours_days_prompt'),
      options: ALL_DAYS.map((d) => ({ value: d, label: dayLabel(d, lang) })),
      initialValues: ALL_DAYS.slice(0, 5),
      required: true,
    })) ?? [];
    days = ALL_DAYS.filter((d) => days.includes(d));
  }
  for (;;) {
    const from = parseClock(await prompter.text({ message: t('wizard.budget.hours_from_prompt'), initialValue: '09:00' }));
    const to = parseClock(await prompter.text({ message: t('wizard.budget.hours_to_prompt'), initialValue: '18:00' }));
    if (from && to && from !== to) return workingHoursOf(days, from, to, timeZone);
    await prompter.note(t('wizard.budget.hours_invalid'), t('wizard.budget.title'));
  }
}

/**
 * Asks the budget (JHT-T345b). One question, the answer already chosen: «$10 a day, every day» (Enter and on), with a sentence on
 * what half an hour of the team really costs. The others: another amount a day; an amount in all for a period; «I set it myself»
 * (a ceiling per day, a budget in all and its period, the working hours, each with its default); no limit. With a subscription the
 * plan paces the team: no question in dollars, only the working hours (BUDGET_SETUP.subscriptionAsksDollars).
 *
 * Returns { kind, budget, workingHours, dailyUsd }: kind = daily | trial | days | until | subscription | none; budget = team.budget
 * or null; dailyUsd = the ceiling per day (no_quota_cap.usd) or null; workingHours null = 24/7, undefined = keep what the config has
 * (the «no limit» answer asks the hours as before).
 * @param {{ t: Function, tf: Function, now?: Date, timeZone?: string, askHours?: Function, provider?: string, lang?: string,
 *   authMethod?: string, setup?: object }} params askHours = the hours step of before (promptWorkingHours), asked only with «no limit»
 */
export async function promptBudget(prompter, { t, tf, now = new Date(), timeZone = localTimeZone(), askHours: askHoursBefore = async () => undefined,
  provider = '', lang = 'en', authMethod = 'api_key', setup = BUDGET_SETUP }) {
  if (authMethod === 'subscription' && !setup.subscriptionAsksDollars) {
    await prompter.note(t('wizard.budget.subscription_note'), t('wizard.budget.title'));
    const workingHours = await askHours(prompter, { t, timeZone, lang, initial: setup.hoursDefault });
    return { kind: 'subscription', budget: null, workingHours, dailyUsd: null };
  }
  const daily = recommendedDaily(provider, setup);
  await prompter.note(costNote(tf, provider, setup), t('wizard.budget.title'));
  const choice = await prompter.select({
    message: t('wizard.budget.prompt'),
    initialValue: 'daily',
    options: [
      { value: 'daily', label: tf('wizard.budget.daily_recommended', tf('wizard.budget.money', String(daily))) },
      { value: 'daily_other', label: t('wizard.budget.daily_other') },
      { value: 'total', label: t('wizard.budget.total') },
      { value: 'custom', label: t('wizard.budget.custom') },
      { value: 'none', label: t('wizard.budget.none') },
    ],
  });
  if (choice === 'none') {
    await prompter.note(t('wizard.budget.none_warning'), t('wizard.budget.title'));
    return { kind: 'none', budget: null, workingHours: await askHoursBefore(), dailyUsd: null };
  }
  if (choice === 'daily') return { kind: 'daily', budget: null, workingHours: null, dailyUsd: daily };
  if (choice === 'daily_other') {
    const dailyUsd = await askDaily(prompter, { t, initial: String(daily), message: 'wizard.budget.daily_amount_prompt', required: true });
    return { kind: 'daily', budget: null, workingHours: null, dailyUsd };
  }
  if (choice === 'total') {
    const usd = await askAmount(prompter, { t, tf, provider, initial: setup.totalProposal.usd });
    const period = await askPeriod(prompter, { t, initial: setup.totalProposal.period });
    return { ...budgetForPeriod(usd, period, now, timeZone), workingHours: null, dailyUsd: null };
  }
  // «I set it myself»: one question at a time, each with the answer Enter keeps
  const dailyUsd = await askDaily(prompter, { t, initial: String(daily) });
  let chosen = { kind: 'daily', budget: null };
  if (await prompter.confirm({ message: t('wizard.budget.total_ask'), initialValue: false }) === true) {
    const usd = await askAmount(prompter, { t, tf, provider, initial: setup.totalProposal.usd });
    const period = await askPeriod(prompter, { t, initial: setup.totalProposal.period });
    chosen = budgetForPeriod(usd, period, now, timeZone);
  }
  const workingHours = await askHours(prompter, { t, timeZone, lang, initial: setup.hoursDefault });
  if (!chosen.budget && !dailyUsd) return { kind: 'none', budget: null, workingHours, dailyUsd: null };
  return { ...chosen, workingHours, dailyUsd };
}

/**
 * The budget of `jht setup --non-interactive` and of `jht budget set`: --budget-usd with one of --budget-minutes,
 * --budget-hours, --budget-days or --budget-until HH[:MM], or --no-budget. Returns { kind, budget } (kind as budgetSummary reads
 * it) or { error } (a sentence), or {} when nothing about the budget was given.
 */
export function budgetFromOptions(opts, { now = new Date(), timeZone = localTimeZone(), setBy = 'setup', prefix = '--budget-', withHours = false } = {}) {
  if (opts.budget === false) return { kind: 'none', budget: null };
  const flag = (name) => `${prefix}${name}`;
  const periods = ['budgetMinutes', ...(withHours ? ['budgetHours'] : []), 'budgetDays', 'budgetUntil'];
  const flags = { budgetMinutes: flag('minutes'), budgetHours: flag('hours'), budgetDays: flag('days'), budgetUntil: flag('until') };
  if (opts.budgetUsd === undefined) {
    return periods.some((k) => opts[k] !== undefined) ? { error: `Give the amount with ${flag('usd')} <dollars>.` } : {};
  }
  const usd = parseUsd(opts.budgetUsd);
  if (usd === null) return { error: `${flag('usd')} must be a positive amount of dollars, for example 10 or 7.5.` };
  const given = periods.filter((k) => opts[k] !== undefined);
  if (given.length !== 1) {
    const list = periods.map((k) => `${flags[k]} <${k === 'budgetUntil' ? 'HH:MM' : 'n'}>`);
    return { error: `Give the period with one of ${list.slice(0, -1).join(', ')} or ${list[list.length - 1]}.` };
  }
  let period;
  if (given[0] === 'budgetUntil') {
    const text = String(opts.budgetUntil).trim();
    const at = /^\d{1,2}$/.test(text) ? `${text}:00` : text;
    period = parseClock(at) ? parseDuration(at) : null;
    if (!period?.until) return { error: `${flags.budgetUntil} is a time of the day, 0:00 to 23:59 (8, 08:00 or 18:30).` };
  } else {
    const n = Number(opts[given[0]]);
    if (!Number.isFinite(n) || n <= 0) return { error: `${flags[given[0]]} must be a positive number.` };
    const minutes = Math.round(n * { budgetMinutes: 1, budgetHours: 60, budgetDays: 24 * 60 }[given[0]]);
    if (minutes < 1) return { error: `${flags[given[0]]} must be at least one minute.` };
    period = { minutes };
  }
  const { kind, budget } = budgetForPeriod(usd, period, now, timeZone);
  const stamped = setBy === 'setup' ? budget : { ...budget, set_by: setBy };
  return { kind, budget: opts.budgetPace === true ? { ...stamped, pace: true } : stamped };
}
