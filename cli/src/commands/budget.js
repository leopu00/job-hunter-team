/**
 * `jht budget`: see, set and remove the team's budget after the setup (JHT-T345).
 *
 * The same fields the setup writes, through the same functions (cli/wizard/setup-budget.js): team.budget (dollars and a
 * period: minutes, hours or days from the first work of the team, or until a time of the day), the ceiling per day
 * (no_quota_cap.usd, the one the brake of pi applies), team.working_hours, and the pace. Nothing here counts or brakes: the
 * brake (shared/skills/pi_spend_cap.py, team_budget.py) reads the config at every tick. A new budget gets a new saved_at,
 * so its dollars and its period start again, as after a new setup.
 *
 *   jht budget                                   what is set now (--json for a program)
 *   jht budget set --usd 3 --minutes 15          $3 for 15 minutes from the first work of the team
 *   jht budget set --usd 10 --until 18:30        $10 until 18:30
 *   jht budget set --daily-usd 5                 at most $5 a day (--daily-usd none removes it)
 *   jht budget set --work-days mon-fri --work-time 09:00-18:00   (--always: every hour)
 *   jht budget clear                             no budget and no ceiling per day
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { JHT_HOME } from '../jht-paths.js';
import { writePrivateJson } from '../lib/secure-config-io.js';
import { localTimeZone } from '../lib/local-tz.js';
import { say, textLanguage } from '../lib/texts.js';
import {
  budgetFromOptions, parseUsd, parseWorkDays, parseWorkTime, workingHoursOf,
} from '../../wizard/setup-budget.js';

const ALL_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const configPath = () => join(JHT_HOME, 'jht.config.json');
const startPath = () => join(JHT_HOME, 'state', 'budget-start.json');

function readConfig() {
  if (!existsSync(configPath())) return null;
  return JSON.parse(readFileSync(configPath(), 'utf-8'));
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return null; }
}

function positive(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** The ceiling per day as the brake reads it (team_budget.no_quota_cap_usd): usd wins, eur is converted. */
function dailyOf(config) {
  const cap = config?.no_quota_cap;
  if (!cap || typeof cap !== 'object') return null;
  const usd = positive(cap.usd);
  if (usd) return { usd, declared: usd, currency: 'USD', pace: cap.pace === true };
  const eur = positive(cap.eur);
  if (!eur) return null;
  return { usd: Math.round(eur * (positive(cap.eur_to_usd) ?? 1) * 1e6) / 1e6, declared: eur, currency: 'EUR', pace: cap.pace === true };
}

/** What is set now, as data: the budget (with the start the brake recorded), the ceiling per day, the working hours. */
export function budgetState(config, start = readJson(startPath())) {
  const raw = config?.team?.budget;
  let budget = null;
  if (raw && typeof raw === 'object' && positive(raw.usd)) {
    const minutes = Number.isFinite(Number(raw.duration_minutes)) ? Number(raw.duration_minutes) : null;
    const started = minutes !== null && start && start.saved_at === raw.saved_at ? start : null;
    budget = {
      usd: raw.usd,
      duration_minutes: minutes,
      starts_at: minutes === null ? raw.starts_at : (started?.starts_at ?? null),
      ends_at: minutes === null ? raw.ends_at : (started?.ends_at ?? null),
      timezone: raw.timezone ?? null,
      pace: raw.pace === true,
      set_by: raw.set_by ?? null,
      saved_at: raw.saved_at ?? raw.starts_at ?? null,
    };
  }
  const hours = config?.team?.working_hours;
  return {
    budget,
    daily: dailyOf(config),
    working_hours: hours && Array.isArray(hours.windows) && hours.windows.length ? hours : null,
  };
}

function clockIn(iso, zone) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: zone || undefined, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(date).replace(',', '');
  } catch { return date.toISOString(); }
}

function durationText(minutes) {
  if (minutes % (24 * 60) === 0) return say('budget.unit_days', { n: minutes / (24 * 60) });
  if (minutes % 60 === 0) return say('budget.unit_hours', { n: minutes / 60 });
  return say('budget.unit_minutes', { n: minutes });
}

function dayNames(days) {
  const monday = Date.UTC(2026, 10, 16, 12);
  return days.map((d) => {
    try {
      return new Intl.DateTimeFormat(textLanguage(), { weekday: 'short', timeZone: 'UTC' }).format(new Date(monday + ALL_DAYS.indexOf(d) * 86_400_000));
    } catch { return d; }
  }).join(', ');
}

/** The lines `jht budget` shows for a state. */
export function describeState(state) {
  const lines = [];
  const b = state.budget;
  if (!b) lines.push(say('budget.none'));
  else {
    lines.push(say('budget.line_amount', { usd: b.usd }));
    const zone = b.timezone || localTimeZone();
    if (b.duration_minutes !== null) {
      lines.push(say('budget.line_duration', { duration: durationText(b.duration_minutes) }));
      lines.push(b.starts_at
        ? say('budget.line_started', { starts: clockIn(b.starts_at, zone), ends: clockIn(b.ends_at, zone), zone })
        : say('budget.line_not_started'));
    } else {
      lines.push(say('budget.line_until', { starts: clockIn(b.starts_at, zone), ends: clockIn(b.ends_at, zone), zone }));
    }
    lines.push(b.pace ? say('budget.line_pace_on') : say('budget.line_pace_off'));
  }
  const d = state.daily;
  if (!d) lines.push(say('budget.line_no_daily'));
  else if (d.currency === 'EUR') lines.push(say('budget.line_daily_eur', { declared: d.declared, usd: d.usd }));
  else lines.push(say('budget.line_daily', { usd: d.usd }));
  // the pace of the ceiling a day applies only without a budget of a period (the brake reads one or the other)
  if (d && d.pace && !b) lines.push(say('budget.line_daily_pace_on'));
  const w = state.working_hours?.windows?.[0];
  if (!w) lines.push(say('budget.line_always'));
  else {
    for (const window of state.working_hours.windows) {
      lines.push(say('budget.line_hours', { days: dayNames(window.days || []), start: window.start, end: window.end, zone: state.working_hours.timezone || 'UTC' }));
    }
  }
  return lines;
}

/**
 * The config with the changes of `jht budget set` applied, or { error } (a sentence for the person). Pure: config, options and
 * a clock in. Options as commander gives them: usd, minutes, hours, days, until, pace ('on'|'off'), dailyUsd, workDays,
 * workTime, always.
 */
export function applySet(config, opts, { now = new Date(), timeZone = localTimeZone() } = {}) {
  const next = structuredClone(config ?? {});
  next.team = next.team && typeof next.team === 'object' ? next.team : {};
  let changed = false;

  let pace;
  if (opts.pace !== undefined) {
    const value = String(opts.pace).trim().toLowerCase();
    if (!['on', 'off'].includes(value)) return { error: say('budget.error_pace') };
    pace = value === 'on';
  }

  const chosen = budgetFromOptions({
    budgetUsd: opts.usd, budgetMinutes: opts.minutes, budgetHours: opts.hours, budgetDays: opts.days,
    budgetUntil: opts.until, budgetPace: pace === true,
  }, { now, timeZone, setBy: 'jht budget', prefix: '--', withHours: true });
  if (chosen.error) return { error: chosen.error };
  if (chosen.budget) {
    // a new budget: a new saved_at, so its dollars and its period start again (as after a new setup)
    next.team.budget = chosen.budget;
    changed = true;
  } else if (pace !== undefined) {
    if (!next.team.budget) return { error: say('budget.error_pace_no_budget') };
    next.team.budget = { ...next.team.budget, pace };
    if (!pace) delete next.team.budget.pace;
    changed = true;
  }

  if (opts.dailyPace !== undefined) {
    const value = String(opts.dailyPace).trim().toLowerCase();
    if (!['on', 'off'].includes(value)) return { error: say('budget.error_pace') };
    const cap = next.no_quota_cap && typeof next.no_quota_cap === 'object' ? { ...next.no_quota_cap } : {};
    if (value === 'on' && !(cap.usd > 0 || cap.eur > 0) && opts.dailyUsd === undefined) return { error: say('budget.error_daily_pace') };
    if (value === 'on') cap.pace = true; else delete cap.pace;
    next.no_quota_cap = cap;
    changed = true;
  }

  if (opts.dailyUsd !== undefined) {
    const text = String(opts.dailyUsd).trim().toLowerCase();
    const cap = next.no_quota_cap && typeof next.no_quota_cap === 'object' ? { ...next.no_quota_cap } : {};
    if (['none', 'off', '0'].includes(text)) {
      delete cap.usd; delete cap.eur; delete cap.eur_to_usd; delete cap.pace;
    } else {
      const usd = parseUsd(text);
      if (usd === null) return { error: say('budget.error_daily') };
      cap.usd = usd;
      delete cap.eur; delete cap.eur_to_usd;
    }
    if (Object.keys(cap).length) next.no_quota_cap = cap; else delete next.no_quota_cap;
    changed = true;
  }

  if (opts.always) {
    if (opts.workDays !== undefined || opts.workTime !== undefined) return { error: say('budget.error_hours') };
    delete next.team.working_hours;
    changed = true;
  } else if (opts.workDays !== undefined || opts.workTime !== undefined) {
    const days = parseWorkDays(opts.workDays);
    const time = parseWorkTime(opts.workTime);
    if (!days || !time) return { error: say('budget.error_hours') };
    next.team.working_hours = workingHoursOf(days, time.start, time.end, next.team.working_hours?.timezone || timeZone);
    changed = true;
  }

  if (!changed) return { error: say('budget.error_nothing') };
  if (Object.keys(next.team).length === 0) delete next.team;
  return { config: next, newBudget: Boolean(chosen.budget) };
}

/** The config without a budget and without a ceiling per day; the working hours stay. */
export function applyClear(config) {
  const next = structuredClone(config ?? {});
  if (next.team && typeof next.team === 'object') {
    delete next.team.budget;
    if (Object.keys(next.team).length === 0) delete next.team;
  }
  if (next.no_quota_cap && typeof next.no_quota_cap === 'object') {
    const cap = { ...next.no_quota_cap };
    delete cap.usd; delete cap.eur; delete cap.eur_to_usd; delete cap.pace;
    if (Object.keys(cap).length) next.no_quota_cap = cap; else delete next.no_quota_cap;
  }
  return next;
}

function loaded() {
  let config;
  try { config = readConfig(); } catch { config = undefined; }
  if (config === undefined) { console.error(say('budget.error_unreadable')); process.exitCode = 1; return null; }
  if (config === null) { console.error(say('budget.error_config')); process.exitCode = 1; return null; }
  return config;
}

function show(opts) {
  const config = loaded();
  if (!config) return;
  const state = budgetState(config);
  if (opts.json) { console.log(JSON.stringify(state)); return; }
  for (const line of describeState(state)) console.log(line);
}

export function registerBudgetCommand(program) {
  const budget = program
    .command('budget')
    .description(say('budget.help.description'))
    .option('--json', say('budget.opt.json'))
    .action((opts) => show(opts));

  budget.command('show')
    .description(say('budget.help.show'))
    .option('--json', say('budget.opt.json'))
    .action((opts) => show(opts));

  budget.command('set')
    .description(say('budget.help.set'))
    .option('--usd <dollars>', say('budget.opt.usd'))
    .option('--minutes <n>', say('budget.opt.minutes'))
    .option('--hours <n>', say('budget.opt.hours'))
    .option('--days <n>', say('budget.opt.days'))
    .option('--until <time>', say('budget.opt.until'))
    .option('--pace <on|off>', say('budget.opt.pace'))
    .option('--daily-usd <dollars|none>', say('budget.opt.daily_usd'))
    .option('--daily-pace <on|off>', say('budget.opt.daily_pace'))
    .option('--work-days <days>', say('budget.opt.work_days'))
    .option('--work-time <from-to>', say('budget.opt.work_time'))
    .option('--always', say('budget.opt.always'))
    .action((opts) => {
      const config = loaded();
      if (!config) return;
      const result = applySet(config, opts);
      if (result.error) { console.error(result.error); process.exitCode = 1; return; }
      writePrivateJson(configPath(), result.config);
      console.log(result.newBudget ? say('budget.saved') : say('budget.updated'));
      for (const line of describeState(budgetState(result.config, null))) console.log(`  ${line}`);
      console.log(say('budget.verify'));
    });

  budget.command('clear')
    .description(say('budget.help.clear'))
    .action(() => {
      const config = loaded();
      if (!config) return;
      writePrivateJson(configPath(), applyClear(config));
      console.log(say('budget.cleared'));
      console.log(say('budget.verify'));
    });
}
