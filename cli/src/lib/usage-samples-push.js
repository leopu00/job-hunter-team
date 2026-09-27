/**
 * The TUI team's usage window (the sentinel bridge's samples: 5-hour usage,
 * week, resets, throttle) sent to the cloud's sentinel_ticks, so the desktop's
 * Budget page and the web can read it where the container is not reachable.
 *
 * Nothing sent it since 22/05 (91ebfb6f2): the daemon used to re-send the
 * last 500 samples every 30 s, ~720 rows an hour per user, and was cut for
 * that volume with the rest. The table and the push route stayed; the cloud's
 * last sample is of 21/05.
 *
 * Now the new samples only, behind a cursor, at most once every
 * USAGE_PUSH_EVERY_MS: one request of /api/cloud-sync/push per quarter hour
 * at most (≤ 96 a day, a Vercel invocation each), none when the bridge wrote
 * nothing new. Its own lane, not the convoy of performPush: a refusal here
 * must not mark the data push as failed, and the convoy's receipts are per
 * row identity, which sentinel_ticks does not have. The route answers how
 * many rows it wrote (sentinel_ticks.upserted); the cursor moves only when
 * that is every row sent. A sample the route would drop (no time, no usage,
 * no provider) is dropped here first, so the count can match.
 */

import { existsSync, readFileSync } from 'node:fs';
import { writePrivateJson } from './secure-config-io.js';

/** At most one request this often. */
export const USAGE_PUSH_EVERY_MS = 15 * 60_000;
/** Rows per request: the route keeps the last 1000 of a body. */
export const USAGE_PUSH_MAX_ROWS = 500;
/**
 * With no cursor yet (first run), the samples of the last day only. Each
 * sample carries the whole window (5 h, week, resets), so the cloud needs the
 * recent ones: a week of backlog, oldest first, would hold back today's.
 */
export const USAGE_FIRST_LOOKBACK_MS = 24 * 60 * 60_000;

/** The route's own rule for a sample it keeps (push/route.ts, 3c). */
export function usableSample(entry) {
  return (
    entry !== null &&
    typeof entry === 'object' &&
    Number.isFinite(Date.parse(entry.ts)) &&
    typeof entry.usage === 'number' &&
    Number.isFinite(entry.usage) &&
    typeof entry.provider === 'string' &&
    entry.provider.trim() !== ''
  );
}

/**
 * The samples after `since` (an ISO time), oldest first, at most `limit`:
 * the oldest ones, so the cursor walks the file in order.
 */
export function readUsageSamples(raw, { since = null, now = Date.now(), limit = USAGE_PUSH_MAX_ROWS } = {}) {
  const from = since ? Date.parse(since) : now - USAGE_FIRST_LOOKBACK_MS;
  const out = [];
  for (const line of String(raw).split(/\r?\n/)) {
    if (!line.startsWith('{')) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!usableSample(entry) || !(Date.parse(entry.ts) > from)) continue;
    out.push(entry);
  }
  out.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  return out.slice(0, limit);
}

function readState(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return {};
  }
}

/**
 * One round of the lane. Returns what it did, for the log and the tests:
 * { sent, advanced, reason }.
 */
export async function pushUsageSamples({
  config,
  samplesPath,
  statePath,
  now = Date.now(),
  every = USAGE_PUSH_EVERY_MS,
  fetchFn = fetch,
  headers,
  signal,
  log = () => {},
}) {
  const state = readState(statePath);
  const lastAttempt = Date.parse(state.last_attempt_at || '');
  if (Number.isFinite(lastAttempt) && now - lastAttempt < every) return { sent: 0, advanced: false, reason: 'not_due' };
  if (!config?.enabled || !config.base_url || !config.token) return { sent: 0, advanced: false, reason: 'not_paired' };
  if (!existsSync(samplesPath)) return { sent: 0, advanced: false, reason: 'no_samples_file' };

  const rows = readUsageSamples(readFileSync(samplesPath, 'utf-8'), { since: state.last_ts || null, now });
  const next = { ...state, last_attempt_at: new Date(now).toISOString() };
  if (rows.length === 0) {
    writePrivateJson(statePath, next);
    return { sent: 0, advanced: false, reason: 'nothing_new' };
  }

  let written = null;
  try {
    const res = await fetchFn(`${config.base_url.replace(/\/+$/, '')}/api/cloud-sync/push`, {
      method: 'POST',
      headers,
      signal,
      body: JSON.stringify({ sentinel_ticks: rows }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) written = Number(body?.sentinel_ticks?.upserted);
    else if (!state.failing) log('warn', 'usage-samples.refused', { status: res.status, error: body?.error });
  } catch (err) {
    if (!state.failing) log('warn', 'usage-samples.failed', { err: err?.message });
  }

  if (written === rows.length) {
    writePrivateJson(statePath, { ...next, last_ts: rows.at(-1).ts, failing: false });
    return { sent: rows.length, advanced: true, reason: 'written' };
  }
  if (written !== null && !state.failing) log('warn', 'usage-samples.count-mismatch', { sent: rows.length, written });
  writePrivateJson(statePath, { ...next, failing: true });
  return { sent: rows.length, advanced: false, reason: written === null ? 'refused' : 'count_mismatch' };
}
