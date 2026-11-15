/**
 * Whether the brake of pi (shared/skills/pi_spend_cap.py) paused the team on its budget (JHT-T322): the budget is spent, the
 * period is over, or the team went faster than the budget spread over the working hours of the period. The brake writes it
 * in the daily-halt flag ($JHT_HOME/logs/daily-halt.flag, reason "pi_spend_cap", pi_spend_cap.why = budget | period | pace)
 * and rewrites it when the reason changes: it is read again at every command. `jht team status`, `jht team start` and
 * `jht doctor` say it; none of them lifts it (a new budget from `jht setup` does, at the next tick of the brake).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JHT_HOME } from '../jht-paths.js';
import { later } from './texts.js';

const WHYS = new Set(['budget', 'period', 'pace']);
const money = (value) => (Number.isFinite(Number(value)) ? Number(value).toFixed(2) : '?');

/** «3:10» for an instant of today, «16/11 3:10» for another day, read in the offset the brake wrote (the zone of the person). */
export function whenOf(iso, now = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(iso ?? ''));
  const at = Date.parse(iso);
  if (!m || Number.isNaN(at)) return null;
  const offset = /([+-])(\d{2}):?(\d{2})$/.exec(iso);
  const shift = offset ? (offset[1] === '-' ? -1 : 1) * (Number(offset[2]) * 60 + Number(offset[3])) : 0;
  const today = new Date(now.getTime() + shift * 60_000).toISOString().slice(0, 10);
  const clock = `${Number(m[4])}:${m[5]}`;
  return today === `${m[1]}-${m[2]}-${m[3]}` ? clock : `${m[3]}/${m[2]} ${clock}`;
}

/** @returns {{ why: 'budget'|'period'|'pace', spent: number, ceiling: number, budgetUsd: number, endsAt: string|null, resumesAt: string|null } | null} */
export function budgetPause({ home = JHT_HOME } = {}) {
  try {
    const flag = JSON.parse(readFileSync(join(home, 'logs', 'daily-halt.flag'), 'utf8'));
    const cap = flag?.pi_spend_cap;
    if (flag?.reason !== 'pi_spend_cap' || !cap || !WHYS.has(cap.why)) return null;
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
  const vars = { spent: money(pause.spent), ceiling: money(pause.ceiling), budget: money(pause.budgetUsd), end: whenOf(pause.endsAt, now) ?? '?' };
  if (pause.why === 'budget') return later('budget.paused_budget', vars);
  if (pause.why === 'period') return later('budget.paused_period', vars);
  const at = whenOf(pause.resumesAt, now);
  return at ? later('budget.paused_pace', { ...vars, at }) : later('budget.paused_pace_late', vars);
}
