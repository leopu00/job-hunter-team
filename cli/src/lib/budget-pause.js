/**
 * Whether the brake of pi (shared/skills/pi_spend_cap.py) paused the team on its budget (JHT-T322): the budget is spent, the
 * period is over, or the team went faster than the budget spread over the working hours of the period. The brake writes it
 * in the daily-halt flag ($JHT_HOME/logs/daily-halt.flag, reason "pi_spend_cap", pi_spend_cap.why = budget | period | pace)
 * and rewrites it when the reason changes: it is read again at every command. `jht team status`, `jht team start` and
 * `jht doctor` say it; none of them lifts it (a new budget from `jht setup` does, at the next tick of the brake).
 */
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { JHT_HOME } from '../jht-paths.js';
import { later } from './texts.js';

const WHYS = new Set(['budget', 'period', 'pace', 'stop_at']);
const money = (value) => (Number.isFinite(Number(value)) ? Number(value).toFixed(2) : '?');

/** The zone the person chose for the budget (the one every time the CLI says is written in). */
function zoneOf(home) {
  try {
    const team = JSON.parse(readFileSync(join(home, 'jht.config.json'), 'utf8'))?.team;
    const zone = String(team?.budget?.timezone || team?.working_hours?.timezone || '').trim();
    return /^[A-Za-z0-9_+./-]+$/.test(zone) ? zone : '';
  } catch { return ''; }
}

/** «3:10 (Europe/Rome)» for an instant of today, «16/11 3:10» for another day, read in the offset the brake wrote (the zone of the person). */
export function whenOf(iso, now = new Date(), zone = '') {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(iso ?? ''));
  const at = Date.parse(iso);
  if (!m || Number.isNaN(at)) return null;
  const offset = /([+-])(\d{2}):?(\d{2})$/.exec(iso);
  const shift = offset ? (offset[1] === '-' ? -1 : 1) * (Number(offset[2]) * 60 + Number(offset[3])) : 0;
  const today = new Date(now.getTime() + shift * 60_000).toISOString().slice(0, 10);
  const clock = `${Number(m[4])}:${m[5]}`;
  const when = today === `${m[1]}-${m[2]}-${m[3]}` ? clock : `${m[3]}/${m[2]} ${clock}`;
  return zone ? `${when} (${zone})` : when;
}

/**
 * True when the flag is the pause of an OLDER budget than the one now in the config. The brake lifts the pause of a spent budget
 * or an ended period at its next tick after `jht setup` (the flag carries no budget of its own), so until then, and in
 * `jht team status` after `jht up`, the old one is still on disk. The setup saves the new budget and starts the team in the same
 * run: it must not say «the period of its budget ended» with the old figures. Three signs, any of which says it is an old one:
 * the period the flag names started, or ended, before the budget in the config was saved (a new period starts after saved_at; this
 * one does not change when something rewrites the flag), or the file itself was written before it was saved. A pause the brake
 * writes for the new budget is later than saved_at on all three and is said. No budget in the config at all: stale (but a stop_at
 * of the Capitano, which is no budget). A budget without saved_at: not stale.
 */
function staleForTheSavedBudget(home, flagPath, cap) {
  try {
    const config = JSON.parse(readFileSync(join(home, 'jht.config.json'), 'utf8'));
    // a pause of a budget when the config has no budget any more (a setup that chose a ceiling per day, `jht budget clear`):
    // the brake lifts it at its next tick, and it is not the person's budget to talk about (JHT-T345b)
    const dailyPace = config?.no_quota_cap?.pace === true && cap?.why === 'pace';
    if (cap?.why !== 'stop_at' && !dailyPace && config && typeof config === 'object' && !config.team?.budget) return true;
    const saved = Date.parse(config?.team?.budget?.saved_at);
    if (!Number.isFinite(saved)) return false;
    const before = (iso) => typeof iso === 'string' && Date.parse(iso) < saved;
    return before(cap?.starts_at) || before(cap?.ends_at) || statSync(flagPath).mtimeMs < saved;
  } catch { return false; }
}

/** @returns {{ why: 'budget'|'period'|'pace'|'stop_at', spent: number, ceiling: number, budgetUsd: number, endsAt: string|null, resumesAt: string|null } | null} */
export function budgetPause({ home = JHT_HOME } = {}) {
  try {
    const flagPath = join(home, 'logs', 'daily-halt.flag');
    const flag = JSON.parse(readFileSync(flagPath, 'utf8'));
    const cap = flag?.pi_spend_cap;
    if (flag?.reason !== 'pi_spend_cap' || !cap || !WHYS.has(cap.why)) return null;
    if (staleForTheSavedBudget(home, flagPath, cap)) return null;
    return { why: cap.why, spent: Number(cap.spent), ceiling: Number(cap.ceiling), budgetUsd: Number(cap.budget_usd ?? cap.ceiling),
      endsAt: typeof cap.ends_at === 'string' ? cap.ends_at : null, resumesAt: typeof cap.resumes_at === 'string' ? cap.resumes_at : null };
  } catch {
    return null;
  }
}

/** The pause as a text to be written later (`show`/`say`), or null when the team is not paused on its budget. */
export function budgetPauseText(options = {}) {
  const pause = budgetPause(options);
  if (!pause) return null;
  const now = options.now ?? new Date();
  const zone = zoneOf(options.home ?? JHT_HOME);
  const vars = { spent: money(pause.spent), ceiling: money(pause.ceiling), budget: money(pause.budgetUsd), end: whenOf(pause.endsAt, now, zone) ?? '?' };
  if (pause.why === 'budget') return later('budget.paused_budget', vars);
  if (pause.why === 'stop_at') return later('budget.paused_stop_at', vars);
  if (pause.why === 'period') return later('budget.paused_period', vars);
  const at = whenOf(pause.resumesAt, now, zone);
  return at ? later('budget.paused_pace', { ...vars, at }) : later('budget.paused_pace_late', vars);
}

/**
 * The person's pause or the technical standby ($JHT_HOME/.team-standby.flag, shared/skills/standby.py), read the way standby.py reads
 * it: an object with an exit condition (an `until` still ahead, or `wake_on.weekly_below`). Null otherwise.
 * @returns {{ kind: 'user'|'standby', since: number|null, until: string|null, byUser: boolean } | null}
 */
export function standbyPause({ home = JHT_HOME, now = new Date() } = {}) {
  try {
    const flag = JSON.parse(readFileSync(join(home, '.team-standby.flag'), 'utf8'));
    if (!flag || typeof flag !== 'object' || Array.isArray(flag)) return null;
    const weekly = flag.wake_on?.weekly_below;
    const wakes = typeof weekly === 'number' && Number.isFinite(weekly);
    let until = NaN;
    if (typeof flag.until === 'string' && flag.until) until = Date.parse(/([zZ]|[+-]\d\d:?\d\d)$/.test(flag.until) ? flag.until : `${flag.until}Z`);
    if (Number.isFinite(until) ? now.getTime() >= until : !wakes) return null;
    return { kind: flag.mode === 'pause' ? 'user' : 'standby', since: Number.isFinite(Number(flag.since)) ? Number(flag.since) : null,
      until: typeof flag.until === 'string' ? flag.until : null, byUser: flag.mode === 'pause' };
  } catch {
    return null;
  }
}

/**
 * The one pause of the team, whatever holds it (JHT-T349/T354): the spending brake first (it holds the team whatever the standby
 * says), then the person's pause, then the technical standby. The same object for `jht team status --json` (`pause`) and its text.
 */
export function teamPause(options = {}) {
  const brake = budgetPause(options);
  if (brake) return { kind: 'budget', ...brake };
  return standbyPause(options);
}

/** The line of `jht team status` for the pause, or null when the team is not paused. */
export function teamPauseText(options = {}) {
  const pause = teamPause(options);
  if (!pause) return null;
  if (pause.kind === 'budget') return budgetPauseText(options);
  if (pause.kind === 'user') return later('agents.paused_user', {});
  const now = options.now ?? new Date();
  return later('agents.paused_standby', { until: whenOf(pause.until, now, zoneOf(options.home ?? JHT_HOME)) ?? '?' });
}

const SPEND_NOW_MAX_AGE_MS = 24 * 3600 * 1000;

/**
 * What the team has spent and at what rate, as the brake wrote it at its last look ($JHT_HOME/state/spend-now.json, every minute):
 * the figure is never the first one told (W1 F-09: «0.06 USD» for a whole afternoon). Null without the file or when it is a day old.
 */
export function spendNowText(options = {}) {
  const seen = spendNow(options);
  if (!seen) return null;
  const clock = new Date(seen.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  const vars = { spent: money(seen.spentUsd), rate: seen.usdPerMin === null ? '?' : seen.usdPerMin.toFixed(3), window: String(seen.windowMin), at: clock };
  if (seen.budgetUsd !== null) return later('budget.spend_now_budget', { ...vars, budget: money(seen.budgetUsd) });
  return later('budget.spend_now_today', vars);
}

/**
 * The same look of the brake as data, for `jht team status --json` (the same in every language): at (ISO), spentUsd, usdPerMin,
 * windowMin, budgetUsd (null when the figure is of today and not of a budget). Null like the text.
 */
export function spendNow({ home = JHT_HOME, now = new Date() } = {}) {
  try {
    const seen = JSON.parse(readFileSync(join(home, 'state', 'spend-now.json'), 'utf8'));
    const at = Number(seen?.at) * 1000;
    const spent = Number(seen?.spent_usd);
    if (!Number.isFinite(at) || !Number.isFinite(spent) || now.getTime() - at > SPEND_NOW_MAX_AGE_MS || at > now.getTime() + 3600 * 1000) return null;
    const rate = Number(seen.usd_per_min);
    const budget = Number(seen.budget_usd);
    return { at: new Date(at).toISOString(), spentUsd: spent, usdPerMin: Number.isFinite(rate) ? rate : null,
      windowMin: Number(seen.window_min) || 10, budgetUsd: seen.counts === 'budget' && budget > 0 ? budget : null };
  } catch {
    return null;
  }
}

/**
 * «Most of the budget went to the onboarding»: the brake writes $JHT_HOME/state/budget-start.json = { saved_at, starts_at,
 * spent_before_usd } at the first work of a Scout, Analista or Scorer. When what the Assistente and the Capitano spent before
 * that is more than half of the budget of the setup (the file is of THIS budget: same saved_at), the person is told, so
 * «I gave $2 and it searched nothing» has its reason. Null when it does not apply or cannot be read.
 */
export function onboardingSpendText({ home = JHT_HOME } = {}) {
  try {
    const start = JSON.parse(readFileSync(join(home, 'state', 'budget-start.json'), 'utf8'));
    const budget = JSON.parse(readFileSync(join(home, 'jht.config.json'), 'utf8'))?.team?.budget;
    const spent = Number(start?.spent_before_usd);
    const usd = Number(budget?.usd);
    if (!budget || !(usd > 0) || !(spent > usd / 2) || !start?.saved_at || start.saved_at !== budget.saved_at) return null;
    return later('budget.onboarding_spend', { spent: money(spent), budget: money(usd) });
  } catch {
    return null;
  }
}

/**
 * «The memory was nearly full and some workers were stopped»: the RAM guard (shared/skills/ram_guard.py) writes
 * $JHT_HOME/state/ram-guard.json = { at (epoch s), retired[], avail_gib, total_gib } at each retirement. Said in `jht team status`
 * for a day after it, because the Captain, who is told too, may be held by the budget brake and never read it. Null otherwise.
 */
export function ramGuardText({ home = JHT_HOME, now = new Date() } = {}) {
  try {
    const seen = JSON.parse(readFileSync(join(home, 'state', 'ram-guard.json'), 'utf8'));
    const at = Number(seen?.at) * 1000;
    const n = Array.isArray(seen?.retired) ? seen.retired.length : 0;
    if (!Number.isFinite(at) || n < 1 || now.getTime() - at > 24 * 3600 * 1000 || at > now.getTime() + 3600 * 1000) return null;
    const clock = new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    return later('agents.ram_guard', { at: clock, n: String(n), free: Number(seen.avail_gib).toFixed(2), total: Number(seen.total_gib).toFixed(1) });
  } catch {
    return null;
  }
}

/**
 * «The quota of the subscription is spent»: shared/skills/quota_wall.py writes $JHT_HOME/state/quota-wall.json = { on, resumes_at
 * (ISO or null), probe, until } while the team is paused because the workers answer the provider's limit. Said in `jht team status`
 * only while the pause stands (the team flag is checked too: a file left behind by a stopped pause says nothing). Null otherwise.
 */
export function quotaWallText({ home = JHT_HOME, now = new Date() } = {}) {
  try {
    const seen = JSON.parse(readFileSync(join(home, 'state', 'quota-wall.json'), 'utf8'));
    const flag = JSON.parse(readFileSync(join(home, '.team-standby.flag'), 'utf8'));
    const until = Date.parse(flag?.until ?? '');
    if (seen?.on !== true || flag?.requested_by !== 'quota' || !(until > now.getTime())) return null;
    const resumes = Date.parse(seen.resumes_at ?? '');
    if (!Number.isFinite(resumes)) return later('agents.quota_wall_unknown', { min: '30' });
    const moment = new Date(resumes);
    const sameDay = moment.toDateString() === now.toDateString();
    const clock = moment.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    const at = sameDay ? clock : `${moment.toLocaleDateString([], { day: '2-digit', month: '2-digit' })} ${clock}`;
    return later('agents.quota_wall', { at });
  } catch {
    return null;
  }
}
