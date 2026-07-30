/**
 * JHT Cron — Calcolo prossima esecuzione per schedule cron/every/at
 */
import { Cron } from 'croner';

const CRON_EVAL_CACHE_MAX = 512;
const cronEvalCache = new Map();

function resolveCronTimezone(tz) {
  const trimmed = typeof tz === 'string' ? tz.trim() : '';
  return trimmed || Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function resolveCachedCron(expr, timezone) {
  const key = `${timezone}\0${expr}`;
  const cached = cronEvalCache.get(key);
  if (cached) return cached;
  if (cronEvalCache.size >= CRON_EVAL_CACHE_MAX) {
    const oldest = cronEvalCache.keys().next().value;
    if (oldest) cronEvalCache.delete(oldest);
  }
  const cron = new Cron(expr, { timezone, catch: false });
  cronEvalCache.set(key, cron);
  return cron;
}

/**
 * Parsa un timestamp assoluto (ISO 8601 o epoch ms).
 * @param {string|number} value
 * @returns {number|null} — ms since epoch, o null se non valido
 */
export function parseAbsoluteTimeMs(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/**
 * Calcola il prossimo timestamp di esecuzione per un dato schedule.
 * @param {import('./types.js').CronSchedule} schedule
 * @param {number} nowMs — timestamp corrente in ms
 * @returns {number|undefined}
 */
export function computeNextRunAtMs(schedule, nowMs) {
  if (schedule.kind === 'at') {
    const atMs = parseAbsoluteTimeMs(schedule.at);
    if (atMs === null) return undefined;
    return atMs > nowMs ? atMs : undefined;
  }

  if (schedule.kind === 'every') {
    const everyMs = typeof schedule.everyMs === 'number' && Number.isFinite(schedule.everyMs)
      ? Math.max(1, Math.floor(schedule.everyMs))
      : undefined;
    if (everyMs === undefined) return undefined;
    const anchor = Math.max(0, Math.floor(schedule.anchorMs ?? nowMs));
    if (nowMs < anchor) return anchor;
    const elapsed = nowMs - anchor;
    const steps = Math.max(1, Math.floor((elapsed + everyMs - 1) / everyMs));
    return anchor + steps * everyMs;
  }

  // kind === 'cron'
  if (typeof schedule.expr !== 'string' || !schedule.expr.trim()) return undefined;
  const cron = resolveCachedCron(schedule.expr.trim(), resolveCronTimezone(schedule.tz));

  let next = cron.nextRun(new Date(nowMs));
  if (!next) return undefined;
  let nextMs = next.getTime();
  if (!Number.isFinite(nextMs)) return undefined;

  // Workaround per bug croner timezone: se il risultato e' nel passato,
  // riprova dal prossimo secondo e poi da domani UTC
  if (nextMs <= nowMs) {
    const nextSecondMs = Math.floor(nowMs / 1000) * 1000 + 1000;
    const retry = cron.nextRun(new Date(nextSecondMs));
    if (retry) {
      const retryMs = retry.getTime();
      if (Number.isFinite(retryMs) && retryMs > nowMs) return retryMs;
    }
    const tomorrowMs = new Date(nowMs).setUTCHours(24, 0, 0, 0);
    const retry2 = cron.nextRun(new Date(tomorrowMs));
    if (retry2) {
      const retry2Ms = retry2.getTime();
      if (Number.isFinite(retry2Ms) && retry2Ms > nowMs) return retry2Ms;
    }
    return undefined;
  }

  return nextMs;
}

/**
 * Calcola il timestamp dell'ultima esecuzione passata (solo per cron).
 * @param {import('./types.js').CronSchedule} schedule
 * @param {number} nowMs
 * @returns {number|undefined}
 */
export function computePreviousRunAtMs(schedule, nowMs) {
  if (schedule.kind !== 'cron') return undefined;
  if (typeof schedule.expr !== 'string' || !schedule.expr.trim()) return undefined;
  const cron = resolveCachedCron(schedule.expr.trim(), resolveCronTimezone(schedule.tz));
  const previousRuns = cron.previousRuns(1, new Date(nowMs));
  const previous = previousRuns[0];
  if (!previous) return undefined;
  const previousMs = previous.getTime();
  if (!Number.isFinite(previousMs) || previousMs >= nowMs) return undefined;
  return previousMs;
}
