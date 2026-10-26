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
 * (atomic, private; role_models role by role), and `settings_applied_at` tells the site it is applied.
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

/**
 * What the launcher (.launcher/start-agent.sh) uses for a role that team.role_models says nothing about:
 * the role map (get_agent_info: an empty alias is opus = sol, "sonnet" is terra; effort high for all).
 * A test runs the launcher's own functions and compares, so the two cannot drift apart.
 */
export const ROLE_DEFAULT_CLASS = Object.freeze({
  capitano: 'sol', scrittore: 'sol', critico: 'sol', mentor: 'sol',
  scout: 'terra', analista: 'terra', scorer: 'terra', assistente: 'terra', sentinella: 'terra', closer: 'terra',
});
export const DEFAULT_EFFORT = 'high';
const CODEX_MODEL = Object.freeze({ sol: 'gpt-5.6-sol', terra: 'gpt-5.6-terra', luna: 'gpt-5.6-luna' });
const CLAUDE_ALIAS = Object.freeze({ sol: 'opus', terra: 'sonnet' });
const PROVIDER_OF = Object.freeze({ codex: 'codex', openai: 'codex', claude: 'claude', anthropic: 'claude', kimi: 'kimi', moonshot: 'kimi' });

/**
 * The model and effort each role is started with, as the launcher decides them at every spawn:
 * { provider, classApplies, effective }, where `effective` maps every role to
 * { model, modelName, effort, from }. `from` is "config" when team.role_models holds a model or an
 * effort for the role.
 * The class (sol, terra, luna) counts only with Codex: with Claude the launcher keeps the role map
 * (opus or sonnet) and takes the effort, so `model` is the role map's and `classApplies` is false.
 * With Kimi (neither model nor effort reach the CLI) and with a provider the launcher does not know
 * (it refuses to start) there is nothing to show: `effective` is null, never a default made up.
 */
export function effectiveSettings(config, roleModels) {
  const provider = PROVIDER_OF[config && typeof config.active_provider === 'string' ? config.active_provider : ''] ?? null;
  const classApplies = provider === 'codex';
  if (provider !== 'codex' && provider !== 'claude') return { provider, classApplies, effective: null };
  const effective = {};
  for (const role of ROLES) {
    const set = roleModels[role] ?? {};
    const model = classApplies && set.model ? set.model : ROLE_DEFAULT_CLASS[role];
    effective[role] = {
      model,
      modelName: classApplies ? CODEX_MODEL[model] : CLAUDE_ALIAS[model],
      effort: set.effort ?? DEFAULT_EFFORT,
      from: set.model || set.effort ? 'config' : 'default',
    };
  }
  return { provider, classApplies, effective };
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

/**
 * The config with the settings applied: only team.working_hours and team.role_models move.
 *
 * role_models is merged role by role: the site replaces only the roles it sends, so a
 * role set on the desktop and never touched from the site stays. An empty entry ({})
 * puts that role back on the default.
 */
export function applySettings(config, desired) {
  const next = isPlainObject(config) ? structuredClone(config) : {};
  if (!isPlainObject(next.team)) next.team = {};
  if ('working_hours' in desired) {
    if (desired.working_hours === null) delete next.team.working_hours;
    else next.team.working_hours = desired.working_hours;
  }
  if ('role_models' in desired) {
    const roles = isPlainObject(next.team.role_models) ? next.team.role_models : {};
    for (const [role, entry] of Object.entries(desired.role_models)) {
      if (Object.keys(entry).length === 0) delete roles[role];
      else roles[role] = structuredClone(entry);
    }
    if (Object.keys(roles).length === 0) delete next.team.role_models;
    else next.team.role_models = roles;
  }
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
