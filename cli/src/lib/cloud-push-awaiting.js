/**
 * Positions acked without their applied status, waiting for their application.
 *
 * The push route writes a position that comes `applied` without its applied
 * status when its application is not complete on the cloud yet, acks it, and
 * lists it in `positions.awaiting_application`: the box's cursor moves on, and
 * the applications request of the same round normally publishes it (the route
 * lists it in `positions.applied`). If the application never arrives complete,
 * the position stays unpublished on the cloud and nothing else says so; before,
 * it ended in quarantine, where it could be seen.
 *
 * This file keeps, per local position id, the push rounds it has been waiting,
 * and says when some of them reach AWAITING_APPLICATION_WARN_ROUNDS. Ids and
 * counters only: nothing of the row itself.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JHT_HOME } from '../jht-paths.js';
import { writePrivateJson } from './secure-config-io.js';

export const CLOUD_PUSH_AWAITING_FILE = join(
  JHT_HOME,
  '.cloud-push-awaiting.json',
);

// Rounds a position may wait for its application before the box warns.
export const AWAITING_APPLICATION_WARN_ROUNDS = 5;

const positionIds = (value) =>
  Array.isArray(value)
    ? value.filter((id) => Number.isInteger(id) && id > 0)
    : [];

export function readAwaitingApplication(path = CLOUD_PUSH_AWAITING_FILE) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    const rounds = {};
    for (const [id, count] of Object.entries(parsed?.rounds ?? {})) {
      if (Number.isInteger(Number(id)) && Number.isInteger(count)) {
        rounds[id] = count;
      }
    }
    return { rounds };
  } catch {
    return { rounds: {} };
  }
}

export function saveAwaitingApplication(
  state,
  path = CLOUD_PUSH_AWAITING_FILE,
) {
  // Nothing waiting and nothing on disk: no file to create at every tick.
  if (Object.keys(state.rounds).length === 0 && !existsSync(path)) return true;
  try {
    writePrivateJson(path, state);
    return true;
  } catch {
    return false;
  }
}

/**
 * One acked request of the push. `rows` are the rows the box sent in it.
 * A position sent and not listed as awaiting is no longer waiting (published,
 * or no longer applied); one listed keeps the rounds it had already waited.
 */
export function observeAwaitingResponse(state, table, rows, body) {
  const awaiting = new Set(positionIds(body?.positions?.awaiting_application));
  if (table === 'positions') {
    for (const row of rows) {
      const id = Number(row?.id);
      if (!Number.isInteger(id)) continue;
      if (!awaiting.has(id)) delete state.rounds[id];
      else if (!(id in state.rounds)) state.rounds[id] = 0;
    }
  }
  for (const id of positionIds(body?.positions?.applied)) {
    delete state.rounds[id];
  }
}

/**
 * The end of a completed push round. `warn` is true only in the round in which
 * some position reaches the threshold: one warning, not one per tick.
 */
export function finishAwaitingRound(
  state,
  warnAfter = AWAITING_APPLICATION_WARN_ROUNDS,
) {
  const stuck = [];
  let reached = false;
  for (const id of Object.keys(state.rounds)) {
    state.rounds[id] += 1;
    if (state.rounds[id] >= warnAfter) stuck.push(Number(id));
    if (state.rounds[id] === warnAfter) reached = true;
  }
  return { warn: reached, stuck };
}
