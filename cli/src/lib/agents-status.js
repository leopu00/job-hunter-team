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
 * Shape, the same for every producer (the JHT API executor may write its
 * own agents later with source "api"):
 *   { "<uid>": { status, since, source: "tui", throttle_left_s? } }
 * `uid` is the tmux session in lower case (capitano, scout-1), as the
 * cloud's by_agent. `since` is when the status last changed, on this box's
 * clock; how old the whole map is, the database stamps (agents_status_at).
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
    if (ev && typeof ev === 'object' && String(ev.agent ?? '') !== '') last[uidOf(ev.agent)] = ev;
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
 * The published map from one reading: pane statuses (after the smoother),
 * the active throttles, and when each status last changed (`changedAt`,
 * kept by the caller between readings).
 */
export function buildAgentsStatus(statuses, throttles, changedAt, now = new Date()) {
  const map = {};
  const nowIso = now.toISOString();
  for (const [session, paneStatus] of Object.entries(statuses)) {
    const uid = uidOf(session);
    if (!uid || uid.includes(' ')) continue;
    // vps_backend.gd _parse_roster: anything but working/idle/paused is idle; a throttle wins
    let status = ['working', 'idle', 'paused'].includes(paneStatus) ? paneStatus : 'idle';
    const t = throttles[uid];
    if (t) status = 'throttled';
    const prev = changedAt.get(uid);
    if (!prev || prev.status !== status) changedAt.set(uid, { status, since: nowIso });
    const entry = { status, since: changedAt.get(uid).since, source: 'tui' };
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
export function createAgentsStatusReader({ jhtHome, run = runRule, readThrottles = readThrottleTail } = {}) {
  const smooth = createSmoother();
  const changedAt = new Map();
  return {
    async read(now = new Date()) {
      const activity = await run();
      if (!activity || typeof activity !== 'object') return null;
      const statuses = smooth(activity);
      const throttles = parseThrottles(await readThrottles(jhtHome), now.getTime() / 1000);
      return buildAgentsStatus(statuses, throttles, changedAt, now);
    },
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
 * Reads every READ_EVERY_MS and writes team_state.agents_status when the
 * statuses changed, or at least every KEEPALIVE_MS so the desktop can tell a
 * live map from an old one. Its own UPDATE, never with the heartbeat: a
 * refused write must not take the heartbeat with it (see migration 089).
 * `write` failing only skips a round. Returns a stop function.
 */
export function startAgentsStatusPublisher({ reader, write, every = READ_EVERY_MS, keepalive = KEEPALIVE_MS, log = () => {} }) {
  let lastKey = null;
  let lastWrite = 0;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const map = await reader.read();
      if (!map) return;
      const key = statusKey(map);
      if (key === lastKey && Date.now() - lastWrite < keepalive) return;
      await write(map);
      lastKey = key;
      lastWrite = Date.now();
    } catch (err) {
      log('warn', 'agents-status.write-failed', { err: err?.message });
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(tick, every);
  timer.unref?.();
  void tick();
  return () => clearInterval(timer);
}
