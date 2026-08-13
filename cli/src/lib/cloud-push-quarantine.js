/**
 * Durable, privacy-safe quarantine for rows rejected by cloud push.
 *
 * The file contains metadata only: table/type, an opaque identity derived from
 * the row's local key, a bounded classification, counters and timestamps.  It
 * never stores the row itself, so titles, message bodies and infrastructure
 * details cannot leak through diagnostics or support bundles.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { JHT_HOME } from "../jht-paths.js";
import { writePrivateJson } from "./secure-config-io.js";

export const CLOUD_PUSH_QUARANTINE_FILE = join(
  JHT_HOME,
  ".cloud-push-quarantine.json",
);

export const QUARANTINE_TABLES = Object.freeze([
  "companies",
  "positions",
  "scores",
  "applications",
  "position_highlights",
  "position_transitions",
  "tombstones",
  "pending_user_messages",
  "profile",
]);

const TABLE_SET = new Set(QUARANTINE_TABLES);
const SAFE_REASON = /^[a-z0-9][a-z0-9_:-]{0,119}$/;

function stableKey(table, row) {
  switch (table) {
    case "companies":
    case "positions":
    case "position_highlights":
    case "pending_user_messages":
      return [row?.id];
    case "scores":
    case "applications":
      return [row?.position_id];
    case "position_transitions":
      return [row?.position_legacy_id, row?.ts, row?.by_agent, row?.to_state];
    case "tombstones":
      return [row?.table_name, row?.legacy_id, row?.deleted_at];
    case "profile":
      return ["candidate_profile"];
    default:
      throw new Error(`unsupported quarantine table: ${table}`);
  }
}

/** Opaque and stable: usable for support without exposing a local primary key. */
export function quarantineIdentity(table, row) {
  if (!TABLE_SET.has(table))
    throw new Error(`unsupported quarantine table: ${table}`);
  return `q_${createHash("sha256")
    .update(`${table}\0${JSON.stringify(stableKey(table, row))}`)
    .digest("hex")
    .slice(0, 24)}`;
}

export function sanitizedQuarantineReason(status, body) {
  const code =
    typeof body?.error === "string" && SAFE_REASON.test(body.error)
      ? body.error
      : "record_rejected";
  const http =
    Number.isInteger(status) && status >= 0 && status <= 999 ? status : 0;
  return `http_${http}:${code}`;
}

function emptyState() {
  return { version: 1, entries: [] };
}

function corruptState() {
  return { version: 1, entries: [], corrupt: true };
}

function validEntry(entry) {
  return (
    entry &&
    typeof entry.identity === "string" &&
    /^q_[a-f0-9]{24}$/.test(entry.identity) &&
    TABLE_SET.has(entry.table) &&
    typeof entry.reason === "string" &&
    SAFE_REASON.test(entry.reason) &&
    Number.isInteger(entry.attempts) &&
    entry.attempts > 0 &&
    ["active", "retry", "resolved"].includes(entry.status)
  );
}

export function readCloudPushQuarantine(path = CLOUD_PUSH_QUARANTINE_FILE) {
  if (!existsSync(path)) return emptyState();
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (
      parsed?.version !== 1 ||
      !Array.isArray(parsed.entries) ||
      parsed.entries.some((entry) => !validEntry(entry))
    )
      return corruptState();
    return {
      version: 1,
      updated_at:
        typeof parsed.updated_at === "string" ? parsed.updated_at : undefined,
      entries: parsed.entries,
    };
  } catch {
    // The caller must reopen all table cursors. Treating corruption as a normal
    // empty state could strand rows behind a cursor that already advanced.
    return corruptState();
  }
}

function saveState(state, path, now) {
  const next = {
    version: 1,
    updated_at: new Date(now).toISOString(),
    entries: state.entries,
  };
  writePrivateJson(path, next);
  return next;
}

/** Clear corruption only after a full replay completed without interruption. */
export function clearCorruptQuarantine(
  { path = CLOUD_PUSH_QUARANTINE_FILE, now = Date.now() } = {},
) {
  const state = readCloudPushQuarantine(path);
  if (state.corrupt !== true) return false;
  saveState(emptyState(), path, now);
  return true;
}

export function quarantineRow({
  table,
  row,
  reason,
  path = CLOUD_PUSH_QUARANTINE_FILE,
  now = Date.now(),
}) {
  if (!TABLE_SET.has(table))
    throw new Error(`unsupported quarantine table: ${table}`);
  if (!SAFE_REASON.test(String(reason || "")))
    throw new Error("unsafe quarantine reason");
  const state = readCloudPushQuarantine(path);
  const identity = quarantineIdentity(table, row);
  const at = new Date(now).toISOString();
  const existing = state.entries.find((entry) => entry.identity === identity);
  if (existing) {
    existing.reason = reason;
    existing.attempts += 1;
    existing.last_failed_at = at;
    existing.status = "active";
    delete existing.retry_requested_at;
    delete existing.resolved_at;
  } else {
    state.entries.push({
      identity,
      table,
      reason,
      attempts: 1,
      first_failed_at: at,
      last_failed_at: at,
      status: "active",
    });
  }
  saveState(state, path, now);
  return identity;
}

export function requestQuarantineRetry(
  identity,
  { path = CLOUD_PUSH_QUARANTINE_FILE, now = Date.now() } = {},
) {
  const state = readCloudPushQuarantine(path);
  const targets = state.entries.filter(
    (entry) =>
      entry.status !== "resolved" &&
      (identity === "all" || entry.identity === identity),
  );
  if (targets.length === 0) return { changed: 0, state };
  const at = new Date(now).toISOString();
  for (const entry of targets) {
    entry.status = "retry";
    entry.retry_requested_at = at;
  }
  return { changed: targets.length, state: saveState(state, path, now) };
}

export function resolveQuarantine(
  identity,
  { path = CLOUD_PUSH_QUARANTINE_FILE, now = Date.now() } = {},
) {
  const state = readCloudPushQuarantine(path);
  const entry = state.entries.find(
    (candidate) =>
      candidate.identity === identity && candidate.status !== "resolved",
  );
  if (!entry) return { changed: 0, state };
  entry.status = "resolved";
  entry.resolved_at = new Date(now).toISOString();
  delete entry.retry_requested_at;
  return { changed: 1, state: saveState(state, path, now) };
}

/** A confirmed retry is resolved only after the server response was read. */
export function resolveConfirmedRetries(
  table,
  rows,
  { path = CLOUD_PUSH_QUARANTINE_FILE, now = Date.now() } = {},
) {
  if (!rows.length) return 0;
  const state = readCloudPushQuarantine(path);
  const identities = new Set(rows.map((row) => quarantineIdentity(table, row)));
  let changed = 0;
  const at = new Date(now).toISOString();
  for (const entry of state.entries) {
    if (
      entry.table === table &&
      entry.status === "retry" &&
      identities.has(entry.identity)
    ) {
      entry.status = "resolved";
      entry.resolved_at = at;
      delete entry.retry_requested_at;
      changed += 1;
    }
  }
  if (changed > 0) saveState(state, path, now);
  return changed;
}

export function activeQuarantineEntries(state) {
  return state.entries.filter((entry) => entry.status !== "resolved");
}

export function retryTables(state) {
  return new Set(
    state.entries
      .filter((entry) => entry.status === "retry")
      .map((entry) => entry.table),
  );
}

/**
 * Active rows stay out of the convoy; retry rows re-enter it.  Returning the
 * held rows lets cursor code count them as durably settled without forgetting
 * that they still require explicit resolution.
 */
export function partitionQuarantinedRows(table, rows, state) {
  const byIdentity = new Map(
    state.entries
      .filter((entry) => entry.table === table && entry.status !== "resolved")
      .map((entry) => [entry.identity, entry]),
  );
  const send = [];
  const held = [];
  for (const row of rows) {
    const entry = byIdentity.get(quarantineIdentity(table, row));
    if (entry?.status === "active") held.push(row);
    else send.push(row);
  }
  return { send, held };
}
