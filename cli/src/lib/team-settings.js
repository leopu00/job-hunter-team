/**
 * team-settings — the settings the site may change on the box (web capace,
 * phase 6): working hours and the model and effort of each role.
 *
 * The site never writes the box's config. It asks the door (`settings.update`,
 * L2) and the database keeps the desire in team_state: `desired_settings` and
 * `desired_settings_at`, stamped with now() by a trigger. The box applies it
 * here, under the rules it has for team commands (team-command-guard.js) and
 * for the team's desired state (team-state-guard.js):
 *
 *   - only the paired user's row (user_id of cloud.json);
 *   - only the closed keys and values below, the same as shared/config/schema.ts:
 *     one value out of them and the whole version is refused, nothing half applied;
 *   - each version once, and only a version newer than the last applied one;
 *     a stamp in the future is refused;
 *   - no age limit: it is a desired state, the user's latest, and applying it
 *     after the box was off is what the user wants (the one difference from P6).
 *
 * Then `team.working_hours` and `team.role_models` are written to jht.config.json
 * (atomic, private), and `settings_applied_at` tells the site it is applied.
 */
import { readFileSync } from 'node:fs';
import { FUTURE_SKEW_MS } from './team-command-guard.js';

export const SETTINGS_KEYS = ['working_hours', 'role_models'];
export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const MIN_WINDOW_HOURS = 4;
export const ROLES = [
  'capitano', 'scout', 'analista', 'scorer', 'scrittore',
  'critico', 'sentinella', 'assistente', 'mentor', 'closer',
];
export const MODEL_CLASSES = ['sol', 'terra', 'luna'];
export const EFFORTS = ['low', 'medium', 'high'];

const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;
const TIMEZONE = /^[A-Za-z0-9_+\-/]{1,64}$/;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const onlyKeys = (obj, allowed) => Object.keys(obj).every((k) => allowed.includes(k));

/** Hours of a HH:MM→HH:MM block; past midnight when end <= start (as the schema). */
export function windowHours(start, end) {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const s = sh * 60 + sm;
  const e = eh * 60 + em;
  return (e > s ? e - s : 24 * 60 - s + e) / 60;
}

function validTimezone(tz) {
  if (typeof tz !== 'string' || !TIMEZONE.test(tz)) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** working_hours as the schema has it, or null (24/7). */
export function validWorkingHours(value) {
  if (value === null) return true;
  if (!isPlainObject(value) || !onlyKeys(value, ['timezone', 'windows'])) return false;
  if (!validTimezone(value.timezone)) return false;
  if (!Array.isArray(value.windows) || value.windows.length > WEEKDAYS.length) return false;
  const seen = new Set();
  for (const w of value.windows) {
    if (!isPlainObject(w) || !onlyKeys(w, ['days', 'start', 'end'])) return false;
    if (!Array.isArray(w.days) || w.days.length === 0) return false;
    for (const d of w.days) {
      if (!WEEKDAYS.includes(d) || seen.has(d)) return false;
      seen.add(d);
    }
    if (typeof w.start !== 'string' || typeof w.end !== 'string') return false;
    if (!TIME_OF_DAY.test(w.start) || !TIME_OF_DAY.test(w.end) || w.start === w.end) return false;
    if (windowHours(w.start, w.end) < MIN_WINDOW_HOURS) return false;
  }
  return true;
}

/** role_models as the schema has it: known roles, model class and effort from the lists. */
export function validRoleModels(value) {
  if (!isPlainObject(value) || !onlyKeys(value, ROLES)) return false;
  return Object.values(value).every(
    (entry) =>
      isPlainObject(entry) &&
      onlyKeys(entry, ['model', 'effort']) &&
      (entry.model === undefined || MODEL_CLASSES.includes(entry.model)) &&
      (entry.effort === undefined || EFFORTS.includes(entry.effort)),
  );
}

/** The desired settings, if every key and value is in the lists; null otherwise. */
export function validSettings(desired) {
  if (!isPlainObject(desired)) return null;
  const keys = Object.keys(desired);
  if (keys.length === 0 || !onlyKeys(desired, SETTINGS_KEYS)) return null;
  if ('working_hours' in desired && !validWorkingHours(desired.working_hours)) return null;
  if ('role_models' in desired && !validRoleModels(desired.role_models)) return null;
  return desired;
}

/**
 * Why this version of the desired settings is not applied, or null.
 *
 * @param {object} state  team_state: user_id, desired_settings, desired_settings_at
 * @param {{ ownerId: string|null, serverNow: number, lastApplied: number|null }} ctx
 */
export function settingsRefusal(state, { ownerId, serverNow, lastApplied }) {
  if (!state || typeof state !== 'object') return 'malformed';
  if (state.desired_settings == null && state.desired_settings_at == null) return 'nothing_desired';
  if (typeof ownerId !== 'string' || ownerId === '') return 'owner_unknown';
  if (state.user_id !== ownerId) return 'not_owner';
  const at = typeof state.desired_settings_at === 'string' ? Date.parse(state.desired_settings_at) : NaN;
  if (!Number.isFinite(at)) return 'no_settings_time';
  if (lastApplied !== null && at <= lastApplied) return 'already_applied';
  if (at > serverNow + FUTURE_SKEW_MS) return 'requested_in_future';
  if (!validSettings(state.desired_settings)) return 'invalid_settings';
  return null;
}

/** The config with the settings applied: only team.working_hours and team.role_models move. */
export function applySettings(config, desired) {
  const next = isPlainObject(config) ? structuredClone(config) : {};
  if (!isPlainObject(next.team)) next.team = {};
  if ('working_hours' in desired) {
    if (desired.working_hours === null) delete next.team.working_hours;
    else next.team.working_hours = desired.working_hours;
  }
  if ('role_models' in desired) next.team.role_models = desired.role_models;
  return next;
}

/** The stamp of the last version applied, from its file; null when none. */
export function readLastApplied(path) {
  try {
    const at = Date.parse(JSON.parse(readFileSync(path, 'utf-8')).applied_at);
    return Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
}
