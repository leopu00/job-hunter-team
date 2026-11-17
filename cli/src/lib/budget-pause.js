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

const WHYS = new Set(['budget', 'period', 'pace']);
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
 * True when the flag was written BEFORE the budget now in the config was saved: it is the pause of the old budget or period, which
 * the brake lifts at its next tick after `jht setup` (the flag carries no budget of its own). The setup itself, right after
 * saving the new budget, must not say «the period of its budget ended»: that was the old one. A flag the brake writes for the
 * new budget comes later than saved_at and is said. No budget, no saved_at, or a flag whose time cannot be read: not stale.
 */
function staleForTheSavedBudget(home, flagPath) {
  try {
    const saved = Date.parse(JSON.parse(readFileSync(join(home, 'jht.config.json'), 'utf8'))?.team?.budget?.saved_at);
    return Number.isFinite(saved) && statSync(flagPath).mtimeMs < saved;
  } catch { return false; }
}

/** @returns {{ why: 'budget'|'period'|'pace', spent: number, ceiling: number, budgetUsd: number, endsAt: string|null, resumesAt: string|null } | null} */
export function budgetPause({ home = JHT_HOME } = {}) {
  try {
    const flagPath = join(home, 'logs', 'daily-halt.flag');
    const flag = JSON.parse(readFileSync(flagPath, 'utf8'));
    const cap = flag?.pi_spend_cap;
    if (flag?.reason !== 'pi_spend_cap' || !cap || !WHYS.has(cap.why)) return null;
    if (staleForTheSavedBudget(home, flagPath)) return null;
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
  if (pause.why === 'period') return later('budget.paused_period', vars);
  const at = whenOf(pause.resumesAt, now, zone);
  return at ? later('budget.paused_pace', { ...vars, at }) : later('budget.paused_pace_late', vars);
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
