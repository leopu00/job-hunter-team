/**
 * team-state-guard — what the box checks before it acts on the desired state
 * of `team_state` (the same rules as team-command-guard.js for team_commands).
 *
 * The desired fields (should_run, restart_token) are written by the user's
 * session, and before the database closes them (P7) by anyone holding it,
 * straight through PostgREST. So, before `jht team start|restart|stop`:
 *
 *   - the row is the paired user's (`user_id` of cloud.json);
 *   - closed fields: should_run a boolean, restart_token a uuid;
 *   - a start or a restart runs only when the desire is fresh by the
 *     database's clock: `desired_changed_at` (stamped with now() by a trigger
 *     when should_run, restart_token or agents_enabled change, migration 098),
 *     against the server's clock. Without that stamp a start or a restart is
 *     refused: before 098 the box cannot tell a desire of a minute ago from
 *     one of last week;
 *   - each start (by stamp), restart (by token) and emergency stop (by its
 *     request) runs once, remembered on disk.
 *
 * A stop is the safe direction: it runs however old the request, with the
 * owner and, for the emergency stop, once per request.
 */
import { FUTURE_SKEW_MS, MAX_AGE_MS } from './team-command-guard.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Why the row is not this box's to act on, or null. */
export function ownerRefusal(state, ownerId) {
  if (!state || typeof state !== 'object') return 'malformed';
  if (typeof ownerId !== 'string' || ownerId === '') return 'owner_unknown';
  if (state.user_id !== ownerId) return 'not_owner';
  return null;
}

/** The key of a start, a restart or an emergency stop in the done store. */
export function desiredKey(kind, state) {
  if (kind === 'restart') return `restart:${state.restart_token}`;
  if (kind === 'start') return `start:${state.desired_changed_at}`;
  if (kind === 'emergency-stop') return `stop:${state.emergency_stop_requested_at}`;
  throw new Error(`unknown kind ${kind}`);
}

/**
 * Why the box refuses a start or a restart from this row, or null.
 *
 * @param {'start'|'restart'} kind
 * @param {object} state  the team_state row
 * @param {{ ownerId: string|null, serverNow: number, done: {has(key: string): boolean} }} ctx
 */
export function desiredRefusal(kind, state, { ownerId, serverNow, done }) {
  const owner = ownerRefusal(state, ownerId);
  if (owner) return owner;
  if (typeof state.should_run !== 'boolean') return 'malformed';
  if (kind === 'restart' && !(typeof state.restart_token === 'string' && UUID.test(state.restart_token))) {
    return 'malformed';
  }
  if (kind === 'start' && state.should_run !== true) return 'malformed';
  const changedAt =
    typeof state.desired_changed_at === 'string' ? Date.parse(state.desired_changed_at) : NaN;
  if (!Number.isFinite(changedAt)) return 'no_desired_time';
  if (done.has(desiredKey(kind, state))) return 'already_executed';
  if (changedAt > serverNow + FUTURE_SKEW_MS) return 'requested_in_future';
  if (serverNow - changedAt > MAX_AGE_MS) return 'expired';
  return null;
}

/**
 * Why the box refuses a plain stop, or null: the owner only. The closed field
 * is the caller's condition (should_run strictly false, observed running).
 */
export function stopRefusal(state, ownerId) {
  return ownerRefusal(state, ownerId);
}

/** Why the box refuses an emergency stop it is asked for, or null: owner and once per request. */
export function emergencyStopRefusal(state, { ownerId, done }) {
  const owner = ownerRefusal(state, ownerId);
  if (owner) return owner;
  if (done.has(desiredKey('emergency-stop', state))) return 'already_executed';
  return null;
}
