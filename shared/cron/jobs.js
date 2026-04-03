/**
 * JHT Cron — Utility per gestione job (create, patch, find, due check)
 */
import { randomUUID } from 'node:crypto';
import { computeNextRunAtMs } from './schedule.js';

/**
 * Crea un nuovo CronJob da un CronJobCreate input.
 * @param {import('./types.js').CronJobCreate} input
 * @returns {import('./types.js').CronJob}
 */
export function createJob(input) {
  const now = Date.now();
  const job = {
    id: randomUUID(),
    name: input.name,
    description: input.description,
    enabled: input.enabled ?? true,
    deleteAfterRun: input.deleteAfterRun,
    createdAtMs: now,
    updatedAtMs: now,
    schedule: input.schedule,
    payload: input.payload,
    state: {
      nextRunAtMs: input.enabled !== false ? computeNextRunAtMs(input.schedule, now) : undefined,
    },
  };
  return job;
}

/**
 * Applica un patch parziale a un job esistente.
 * @param {import('./types.js').CronJob} job
 * @param {import('./types.js').CronJobPatch} patch
 */
export function applyJobPatch(job, patch) {
  const now = Date.now();
  if (patch.name !== undefined) job.name = patch.name;
  if (patch.description !== undefined) job.description = patch.description;
  if (patch.enabled !== undefined) job.enabled = patch.enabled;
  if (patch.deleteAfterRun !== undefined) job.deleteAfterRun = patch.deleteAfterRun;
  if (patch.schedule !== undefined) job.schedule = patch.schedule;
  if (patch.payload !== undefined) job.payload = patch.payload;
  job.updatedAtMs = now;

  if (patch.schedule !== undefined || patch.enabled !== undefined) {
    job.state.nextRunAtMs = job.enabled ? computeNextRunAtMs(job.schedule, now) : undefined;
    if (!job.enabled) job.state.runningAtMs = undefined;
  }
}

/**
 * Verifica se un job e' abilitato.
 * @param {import('./types.js').CronJob} job
 * @returns {boolean}
 */
export function isJobEnabled(job) {
  return job.enabled === true;
}

/**
 * Verifica se un job e' "due" (pronto per esecuzione).
 * @param {import('./types.js').CronJob} job
 * @param {number} nowMs
 * @param {{ forced?: boolean }} [opts]
 * @returns {boolean}
 */
export function isJobDue(job, nowMs, opts) {
  if (!isJobEnabled(job)) return false;
  if (typeof job.state.runningAtMs === 'number') return false;
  if (opts?.forced) return true;
  const nextRun = job.state.nextRunAtMs;
  return typeof nextRun === 'number' && nextRun <= nowMs;
}

/**
 * Ricalcola nextRunAtMs per tutti i job abilitati.
 * @param {import('./types.js').CronJob[]} jobs
 * @returns {boolean} — true se almeno un job e' stato modificato
 */
export function recomputeNextRuns(jobs) {
  const now = Date.now();
  let changed = false;
  for (const job of jobs) {
    if (!isJobEnabled(job)) continue;
    const next = computeNextRunAtMs(job.schedule, now);
    if (job.state.nextRunAtMs !== next) {
      job.state.nextRunAtMs = next;
      changed = true;
    }
  }
  return changed;
}

/**
 * Trova il prossimo wakeAtMs tra tutti i job (il piu' vicino).
 * @param {import('./types.js').CronJob[]} jobs
 * @returns {number|null}
 */
export function nextWakeAtMs(jobs) {
  let earliest = null;
  for (const job of jobs) {
    const next = job.state.nextRunAtMs;
    if (typeof next === 'number' && (earliest === null || next < earliest)) {
      earliest = next;
    }
  }
  return earliest;
}
