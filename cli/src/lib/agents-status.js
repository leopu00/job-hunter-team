/**
 * What each agent of the TUI team is doing, published on the cloud
 * (team_state.agents_status, migration 089) so the desktop office can tag
 * them as the Godot game does: WORKING, WAITING, PAUSED, THROTTLED.
 *
 * ONE rule, the game's:
 *   - the pane: shared/skills/agent_activity.py, byte for byte the game's
 *     payload (game/scripts/backend/payloads/agent_activity.py; a pytest
 *     keeps the two identical). It reads the last 14 lines of every tmux
 *     session and says working / paused / idle (or unknown when the pane
 *     cannot be read), with a second look at the idle ones;
 *   - the pacing: an agent inside a throttle window is "throttled"
 *     (vps_backend.gd _parse_throttles, on logs/throttle-events.jsonl);
 *   - the hysteresis: a "working" becomes "idle" only at the second idle
 *     reading in a row, and "unknown" keeps the last state
 *     (vps_backend.gd _smooth_activity).
 * Here it is only run and published, not reinterpreted.
 *
 * Shape, one key per source (migration 089): this producer writes
 *   { tui: { agents: { "<uid>": { status, since, throttle_left_s? } } } }
 * and the database merges it next to the other sources (the JHT API
 * executor's, agents-status-traces.js, under "api") and stamps its "at".
 * `uid` is canonicalAgentId's: the TUI session in lower case (capitano,
 * scout-1, critico-s2), as the cloud's by_agent. `since` is when the status
 * last changed, on this box's clock.
 */

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const RULE_SCRIPT = join(HERE, '../../../shared/skills/agent_activity.py');

/** vps_backend.gd reads the last 60 lines of the pacing log. */
const THROTTLE_TAIL = 60;

/** The session name as a key: trimmed, lower case. */
export function uidOf(session) {
  return String(session).trim().toLowerCase();
}

/**
 * The roles the TUI starts without an instance number (.launcher/spawn-lib.sh
 * jht_spawn_session_name: CAPITANO, not CAPITANO-1). A test keeps the list
 * equal to the launcher's.
 */
export const SINGLE_ROLES = ['capitano', 'critico', 'sentinella', 'assistente', 'mentor'];

/**
 * The one name an agent goes by in agents_status, whoever publishes it: the
 * TUI session in lower case. The JHT API executor numbers every agent
 * (agent-harness agentInstanceId: capitano -> capitano-1, scout -> scout-1),
 * the TUI numbers all but SINGLE_ROLES; both land on capitano, scout-1.
 * critico-s2 (a writer's own critic) and other hyphenated names stay as
 * they are.
 */
export function canonicalAgentId(name) {
  const id = uidOf(name);
  const m = /^(.+)-(\d+)$/.exec(id);
  if (m) return m[2] === '1' && SINGLE_ROLES.includes(m[1]) ? m[1] : id;
  // a bare role word is instance 1 (start-agent.sh scout starts SCOUT-1); anything else stays
  return /^[a-z]+$/.test(id) && !SINGLE_ROLES.includes(id) ? `${id}-1` : id;
}

/**
 * vps_backend.gd _parse_throttles: the LAST event of each agent counts; a
 * "start" whose window (ts_unix + applied_sec) covers now is a throttle in
 * progress. Returns { uid: { left, total } } in seconds.
 */
export function parseThrottles(raw, nowS = Date.now() / 1000) {
  const last = {};
  for (const line of String(raw).split('\n')) {
    if (!line.startsWith('{')) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev && typeof ev === 'object' && String(ev.agent ?? '') !== '') last[canonicalAgentId(ev.agent)] = ev;
  }
  const active = {};
  for (const [uid, ev] of Object.entries(last)) {
    if (String(ev.event ?? '') !== 'start') continue;
    const total = Number(ev.applied_sec ?? 0) || 0;
    const until = (Number(ev.ts_unix ?? 0) || 0) + total;
    if (until > nowS) active[uid] = { left: until - nowS, total };
  }
  return active;
}

/**
 * vps_backend.gd _smooth_activity, with its memory kept in `memory` between
 * calls: "unknown" keeps the last status; a "working" drops to "idle" only
 * at the second idle in a row.
 */
export function createSmoother() {
  const lastStatus = new Map();
  const idleStrikes = new Map();
  return function smooth(activity) {
    const out = {};
    for (const [session, obs] of Object.entries(activity || {})) {
      let status = String(obs?.status ?? 'idle');
      const prev = lastStatus.get(session) ?? '';
      if (status === 'unknown') {
        status = prev !== '' ? prev : 'idle';
      } else if (status === 'idle' && prev === 'working') {
        const strikes = (idleStrikes.get(session) ?? 0) + 1;
        if (strikes < 2) {
          idleStrikes.set(session, strikes);
          status = 'working';
        } else {
          idleStrikes.set(session, 0);
        }
      } else {
        idleStrikes.set(session, 0);
      }
      out[session] = status;
      lastStatus.set(session, status);
    }
    return out;
  };
}

/**
 * The names the web route and the desktop accept for an agent
 * (web/lib/team-state/agents-status.ts): lower case, digits, hyphens. A tmux
 * session opened by hand with another name is not an agent of the team.
 */
export const UID_FORMAT = /^[a-z0-9][a-z0-9-]{0,39}$/;

/**
 * Tells once per name that a name is left out of the map: the others are
 * published, and the log does not repeat the same line every 20 s.
 */
export function createDroppedNameLog(log = () => {}) {
  const told = new Set();
  return (name) => {
    if (told.has(name)) return;
    told.add(name);
    log('warn', 'agents-status.name-dropped', { name: String(name).slice(0, 60) });
  };
}

/**
 * The published map from one reading: pane statuses (after the smoother),
 * the active throttles, and when each status last changed (`changedAt`,
 * kept by the caller between readings). A name outside UID_FORMAT is left
 * out and handed to `dropped`.
 */
export function buildAgentsStatus(statuses, throttles, changedAt, now = new Date(), dropped = () => {}) {
  const map = {};
  const nowIso = now.toISOString();
  for (const [session, paneStatus] of Object.entries(statuses)) {
    const uid = canonicalAgentId(session);
    if (!UID_FORMAT.test(uid)) {
      dropped(session);
      continue;
    }
    // vps_backend.gd _parse_roster: anything but working/idle/paused is idle; a throttle wins
    let status = ['working', 'idle', 'paused'].includes(paneStatus) ? paneStatus : 'idle';
    const t = throttles[uid];
    if (t) status = 'throttled';
    const prev = changedAt.get(uid);
    if (!prev || prev.status !== status) changedAt.set(uid, { status, since: nowIso });
    const entry = { status, since: changedAt.get(uid).since };
    if (t) entry.throttle_left_s = Math.round(t.left);
    map[uid] = entry;
  }
  for (const uid of [...changedAt.keys()]) if (!(uid in map)) changedAt.delete(uid);
  return map;
}

function runRule(python = 'python3') {
  return new Promise((resolve) => {
    execFile(python, [RULE_SCRIPT], { timeout: 20_000, maxBuffer: 1 << 20 }, (err, stdout) => {
      if (err) return resolve(null);
      // vps_backend.gd _parse_activity: only a JSON object line counts
      for (const line of String(stdout).split('\n')) {
        if (!line.startsWith('{')) continue;
        try { return resolve(JSON.parse(line)); } catch { /* next line */ }
      }
      resolve(null);
    });
  });
}

async function readThrottleTail(jhtHome) {
  try {
    const raw = await readFile(join(jhtHome, 'logs', 'throttle-events.jsonl'), 'utf8');
    return raw.split('\n').slice(-THROTTLE_TAIL - 1).join('\n');
  } catch {
    return '';
  }
}

/**
 * A publisher that keeps the smoother's and the `since` memory for the life
 * of the daemon. `read()` answers the map to publish, or null when the rule
 * could not run (then nothing is published, and the desktop shows no tag).
 */
export function createAgentsStatusReader({ jhtHome, run = runRule, readThrottles = readThrottleTail, log } = {}) {
  const smooth = createSmoother();
  const changedAt = new Map();
  const dropped = createDroppedNameLog(log);
  return {
    async read(now = new Date()) {
      const activity = await run();
      if (!activity || typeof activity !== 'object') return null;
      const statuses = smooth(activity);
      const throttles = parseThrottles(await readThrottles(jhtHome), now.getTime() / 1000);
      return buildAgentsStatus(statuses, throttles, changedAt, now, dropped);
    },
  };
}

/**
 * The PATCH a producer sends: only its own source's key. The database merges
 * it next to the other sources and stamps its "at" (migration 089).
 */
export function agentsStatusPatch(source, agents) {
  return { agents_status: { [source]: { agents } } };
}

/**
 * How a box writes its source: direct to Supabase when it has a session
 * (`direct`, supabase-direct's patchTeamState), otherwise handed to the
 * `carrier` (createHeartbeatCarrier), which the heartbeat takes along.
 */
export function agentsStatusWriter({ source, direct, carrier }) {
  return (map) => (direct ? direct.patchTeamState(agentsStatusPatch(source, map)) : carrier.hold(map));
}

/**
 * A box without a Supabase session writes through PATCH /api/team-state, and
 * every request there is a Vercel invocation, billed by the boxes that make
 * them: its own write every 20-60 s cost one box 1,440-4,320 a day for the
 * tags alone. So the statuses ride the heartbeat's PATCH, once a minute, and
 * a change waits for the next beat.
 *
 * `fields()` is what the heartbeat adds to its body: the last map, or
 * nothing. A refusal of that body (a web route older than the field answers
 * 403, a shape the route or the database refuses 400) must not take the
 * heartbeat with it: the heartbeat tells the carrier `refused()`, sends
 * itself alone, and for `refusedRetry` the carrier adds nothing.
 */
export function createHeartbeatCarrier({ source, refusedRetry = REFUSED_RETRY_MS, now = Date.now }) {
  let held = null;
  let refusedUntil = 0;
  return {
    hold: async (map) => { held = map; },
    fields: () => (held && now() >= refusedUntil ? agentsStatusPatch(source, held) : {}),
    refused: () => { refusedUntil = now() + refusedRetry; },
  };
}

/** How often the rule is read, and the longest silence between two writes. */
export const READ_EVERY_MS = 20_000;
export const KEEPALIVE_MS = 60_000;

/** The map without the `since` stamps: what "changed" means for a write. */
export function statusKey(map) {
  return JSON.stringify(
    Object.keys(map)
      .sort()
      .map((uid) => [uid, map[uid].status, map[uid].throttle_left_s == null ? null : Math.round(map[uid].throttle_left_s / 30)]),
  );
}

/**
 * After the server said no (an HTTP status: a web route older than this
 * field answers 403, a cloud without migration 089 refuses the column), the
 * next write waits this long. Nothing changes by asking every 20 s.
 */
export const REFUSED_RETRY_MS = 30 * 60_000;

/**
 * Reads every READ_EVERY_MS and writes team_state.agents_status when the
 * statuses changed, or at least every KEEPALIVE_MS so the desktop can tell a
 * live map from an old one. With a session it is its own write, never with
 * the heartbeat: a refused write must not take the heartbeat with it (see
 * migration 089). Without one the write only hands the map to the heartbeat
 * (createHeartbeatCarrier), which keeps that promise itself.
 * A failed write logs once, then stays quiet until one succeeds again; a
 * refusal (the error carries an HTTP `status`) also waits REFUSED_RETRY_MS
 * before the next try, a network error only the next round. Returns a stop
 * function.
 */
export function startAgentsStatusPublisher({
  reader,
  write,
  every = READ_EVERY_MS,
  keepalive = KEEPALIVE_MS,
  refusedRetry = REFUSED_RETRY_MS,
  log = () => {},
}) {
  let lastKey = null;
  let lastWrite = 0;
  let busy = false;
  let failing = false;
  let retryAt = 0;
  const tick = async () => {
    if (busy || Date.now() < retryAt) return;
    busy = true;
    try {
      const map = await reader.read();
      if (!map) return;
      const key = statusKey(map);
      if (key === lastKey && Date.now() - lastWrite < keepalive) return;
      await write(map);
      lastKey = key;
      lastWrite = Date.now();
      if (failing) log('info', 'agents-status.write-resumed', {});
      failing = false;
    } catch (err) {
      const refused = typeof err?.status === 'number';
      if (!failing) {
        log('warn', 'agents-status.write-failed', {
          err: err?.message,
          ...(refused ? { status: err.status, retry_in_s: Math.round(refusedRetry / 1000) } : {}),
        });
      }
      failing = true;
      if (refused) retryAt = Date.now() + refusedRetry;
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(tick, every);
  timer.unref?.();
  void tick();
  return () => clearInterval(timer);
}
