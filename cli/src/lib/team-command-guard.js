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
 *     as pending.
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
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    if (parsed && typeof parsed.ids === 'object' && parsed.ids !== null) ids = parsed.ids;
  } catch {
    ids = {};
  }
  const prune = () => {
    const limit = now() - keepMs;
    for (const [id, at] of Object.entries(ids)) {
      if (typeof at !== 'number' || at < limit) delete ids[id];
    }
  };
  prune();
  return {
    has(id) {
      return Object.prototype.hasOwnProperty.call(ids, id);
    },
    add(id) {
      prune();
      ids[id] = now();
      mkdirSync(dirname(path), { recursive: true });
      const tmp = `${path}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify({ ids }), { mode: 0o600 });
      renameSync(tmp, path);
    },
  };
}
