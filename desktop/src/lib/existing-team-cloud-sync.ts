import { invoke } from "@tauri-apps/api/core";
import { teamStatusErrorCode } from "./existing-team-status";

/**
 * How the box's push to the website is going, read from the team's VPS (the reader's op
 * `cloud_sync`: the periodic push's own last outcome, never the box's cloud configuration).
 * A box whose token the website refuses fails every push and the website cannot say so: the app
 * connected to the team does.
 *
 * An auxiliary read: it does not report to the link of the header (vps-link), so a team on an
 * image that does not know the op (it answers positions_request_invalid) never looks like a
 * broken link, and nothing the other pages enable depends on it.
 */

const COMMAND = "existing_team_positions_read";

export const CLOUD_SYNC_STATUSES = [
  "completed", "idle", "partial", "timeout", "auth_failed", "failed", "signature_unavailable", "other",
] as const;
export type CloudSyncStatus = (typeof CLOUD_SYNC_STATUSES)[number];

export type CloudSyncState =
  | { state: "absent" }
  | { state: "unreadable" }
  | {
      state: "ok";
      status: CloudSyncStatus;
      lastSuccessAt: string | null;
      lastAttemptAt: string | null;
      consecutiveFailures: number;
    };

export type CloudSyncReading =
  | { kind: "read"; at: number; sync: CloudSyncState }
  /** The team runs an image whose reader does not know the op. */
  | { kind: "unsupported"; at: number }
  | { kind: "error"; at: number; code: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const textOrNull = (value: unknown): value is string | null => value === null || typeof value === "string";

/** The reader's data as the page uses it, or null for anything else. */
export function pickCloudSync(data: unknown): CloudSyncState | null {
  if (!isRecord(data)) return null;
  if ((data.state === "absent" || data.state === "unreadable") && Object.keys(data).length === 1) {
    return { state: data.state };
  }
  if (
    data.state !== "ok" ||
    Object.keys(data).length !== 5 ||
    !(CLOUD_SYNC_STATUSES as readonly unknown[]).includes(data.status) ||
    !textOrNull(data.last_success_at) ||
    !textOrNull(data.last_attempt_at) ||
    typeof data.consecutive_failures !== "number" ||
    !Number.isInteger(data.consecutive_failures) ||
    data.consecutive_failures < 0
  ) {
    return null;
  }
  return {
    state: "ok",
    status: data.status as CloudSyncStatus,
    lastSuccessAt: data.last_success_at,
    lastAttemptAt: data.last_attempt_at,
    consecutiveFailures: data.consecutive_failures,
  };
}

/** Reads it again from the team's VPS: nothing is kept between two reads. */
export async function readExistingTeamCloudSync(
  read: () => Promise<unknown> = () => invoke<unknown>(COMMAND, { request: { op: "cloud_sync" } }),
  now: () => number = Date.now,
): Promise<CloudSyncReading> {
  try {
    const reply = await read();
    if (!isRecord(reply)) return { kind: "error", at: now(), code: "desktop_bad_reply" };
    if (reply.ok === false) {
      return reply.error === "positions_request_invalid"
        ? { kind: "unsupported", at: now() }
        : { kind: "error", at: now(), code: teamStatusErrorCode(reply.error) };
    }
    const sync = reply.ok === true ? pickCloudSync(reply.data) : null;
    return sync ? { kind: "read", at: now(), sync } : { kind: "error", at: now(), code: "desktop_bad_reply" };
  } catch (error) {
    return { kind: "error", at: now(), code: teamStatusErrorCode(error) };
  }
}
