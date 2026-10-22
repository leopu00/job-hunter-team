/**
 * team-command-guard — what the box checks before it runs a team command
 * that came from the cloud.
 *
 * A row of `team_commands` is untrusted input: the site writes it, but so can
 * anyone holding the user's session, straight through PostgREST, with any
 * `requested_at` and with `status` put back to `pending` after it ran. The box
 * is where the command has an effect, so the box decides:
 *
 *   - only the closed vocabulary (start/stop/restart on a known target);
 *   - only rows of the user this box is paired with (`user_id` of cloud.json);
 *   - the age comes from the database: `requested_at` is `DEFAULT now()` and
 *     the site never sends it; it is compared with the server's clock (the
 *     `Date` of the reply that brought the row), not with the box's. A row
 *     older than 10 minutes is refused (a start queued while the box was off
 *     must not run the next day), and so is a row from the future;
 *   - one run per id: an id that already ran is refused even if it comes back
 *     as pending;
 *   - a cap per hour, the same as the door's (migration 099): start and
 *     restart 6 together, stop 12. The door has it too, but the box runs what
 *     reaches it, and before the door a session could write the table
 *     straight: past the cap the row is closed as `rate_limited`, not run.
 *
 * No dependencies: the poller imports it, and so do the tests.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const MAX_AGE_MS = 10 * 60 * 1000;
/** How far in the future a row may be: the clocks of the database and of the web server, and the `Date` header's whole seconds. */
export const FUTURE_SKEW_MS = 60 * 1000;
/** How long an executed id is remembered: far longer than MAX_AGE_MS, after which the age refuses the row anyway. */
export const DONE_KEEP_MS = 24 * 60 * 60 * 1000;

export const VALID_ACTIONS = new Set(['start', 'stop', 'restart']);

/** The door's caps (web_door.vocab, migration 099): per group, per hour, counted on the commands the box ran. */
export const CAP_WINDOW_MS = 60 * 60 * 1000;
export const COMMAND_CAPS = Object.freeze({
  up: Object.freeze({ actions: Object.freeze(['start', 'restart']), max: 6 }),
  down: Object.freeze({ actions: Object.freeze(['stop']), max: 12 }),
});

/** The cap group of an action: 'up' (start, restart), 'down' (stop), or null. */
export function capGroup(action) {
  for (const [group, cap] of Object.entries(COMMAND_CAPS)) {
    if (cap.actions.includes(action)) return group;
  }
  return null;
}

/**
 * 'rate_limited' when the box already ran its hour's share of this command's
 * group, else null. Only the commands the box ran count: a refused row does not.
 * The hour is the box's own, on the store's clock (the one that stamped them).
 *
 * @param {object} command
 * @param {{ countWithin(group: string, windowMs: number): number }} done
 */
export function capRefusal(command, done) {
  const group = capGroup(command?.action);
  if (!group) return null;
  return done.countWithin(group, CAP_WINDOW_MS) >= COMMAND_CAPS[group].max ? 'rate_limited' : null;
}
export const VALID_TARGETS = new Set([
  'all',
  'assistente',
  'capitano',
  'sentinella',
  'scout',
  'scorer',
  'analista',
  'scrittore',
  'critico',
  'mentor',
  'bridge',
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The server's clock from an HTTP `Date` header, in ms; null when absent or unreadable. */
export function serverClock(dateHeader) {
  if (typeof dateHeader !== 'string' || dateHeader.trim() === '') return null;
  const ms = Date.parse(dateHeader);
  return Number.isFinite(ms) ? ms : null;
}

/** The target of a command, as the site writes it in the payload. */
export function commandTarget(command) {
  const payload = command && typeof command.payload === 'object' ? command.payload : null;
  return String((payload && payload.target) || 'all').toLowerCase();
}

/**
 * Why the box refuses this command, or null when it may run.
 *
 * @param {object} command   a row from the poll: id, user_id, action, payload, requested_at
 * @param {object} ctx
 * @param {string|null} ctx.ownerId    user_id of cloud.json
 * @param {number} ctx.serverNow       the server's clock now, in ms
 * @param {{has(id: string): boolean}} ctx.done  ids that already ran
 */
export function commandRefusal(command, { ownerId, serverNow, done }) {
  if (!command || typeof command !== 'object') return 'malformed';
  const { id } = command;
  if (typeof id !== 'string' || !UUID.test(id)) return 'malformed';
  if (done.has(id)) return 'already_executed';
  if (typeof ownerId !== 'string' || ownerId === '') return 'owner_unknown';
  if (command.user_id !== ownerId) return 'not_owner';
  if (!VALID_ACTIONS.has(command.action)) return 'invalid_action';
  const target = commandTarget(command);
  if (!VALID_TARGETS.has(target)) return 'invalid_target';
  if (target === 'bridge' && command.action === 'restart') return 'bridge_no_restart';
  const requestedAt =
    typeof command.requested_at === 'string' ? Date.parse(command.requested_at) : NaN;
  if (!Number.isFinite(requestedAt)) return 'no_request_time';
  if (requestedAt > serverNow + FUTURE_SKEW_MS) return 'requested_in_future';
  if (serverNow - requestedAt > MAX_AGE_MS) return 'expired';
  return null;
}

/**
 * The ids that already ran, on disk so a restart of the poller remembers them.
 * Written before the command runs: at most once, never twice.
 */
export function createDoneStore(path, { keepMs = DONE_KEEP_MS, now = Date.now } = {}) {
  let ids = {};
  // The cap group of each id (the file before the cap has none: those ids count for no group).
  let groups = {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    if (parsed && typeof parsed.ids === 'object' && parsed.ids !== null) ids = parsed.ids;
    if (parsed && typeof parsed.groups === 'object' && parsed.groups !== null) groups = parsed.groups;
  } catch {
    ids = {};
    groups = {};
  }
  const prune = () => {
    const limit = now() - keepMs;
    for (const [id, at] of Object.entries(ids)) {
      if (typeof at !== 'number' || at < limit) delete ids[id];
    }
    for (const id of Object.keys(groups)) {
      if (!Object.prototype.hasOwnProperty.call(ids, id)) delete groups[id];
    }
  };
  prune();
  return {
    has(id) {
      return Object.prototype.hasOwnProperty.call(ids, id);
    },
    /** @param {string} id  @param {string} [group]  the cap group, when the id is a team command */
    add(id, group) {
      prune();
      ids[id] = now();
      if (typeof group === 'string' && group) groups[id] = group;
      mkdirSync(dirname(path), { recursive: true });
      const tmp = `${path}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify({ ids, groups }), { mode: 0o600 });
      renameSync(tmp, path);
    },
    /** How many ids of `group` were added in the last `windowMs`. */
    countWithin(group, windowMs) {
      const since = now() - windowMs;
      let n = 0;
      for (const [id, g] of Object.entries(groups)) {
        if (g === group && typeof ids[id] === 'number' && ids[id] >= since) n += 1;
      }
      return n;
    },
  };
}
