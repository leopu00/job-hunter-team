import { invoke } from "@tauri-apps/api/core";
import { WRITE_TARGET_COMMAND } from "./vps-judgement-api";

/**
 * The website sync token of the box of an existing team: how long it lasts, and its renewal from
 * the app, so that nobody opens a terminal on the box (src-tauri/src/existing_team_cloud_token.rs,
 * which runs shared/skills/cloud_token.py in the team's pinned container).
 *
 * A token with an expiry, once expired, cuts the box off the website in silence: on 23/10 a box
 * was refused for 16 days and nothing said so. The renewal is two steps for the user: the website
 * mints the token (the app never does), the app hands it to the box, which keeps it only if the
 * website accepts it and it belongs to the account the box is paired with.
 *
 * The token is a secret: it is held by the field that receives it and by the one call that sends
 * it, never stored, never logged, never in an error.
 */

const COMMAND = "existing_team_cloud_token";
const OPEN_SITE = "existing_team_cloud_token_open_site";
const TARGET = WRITE_TARGET_COMMAND;

/** A sync token as the website mints it: `jht_sync_` and base64url characters. */
const TOKEN = /^jht_sync_[A-Za-z0-9_-]{16,128}$/;

export const isSyncToken = (value: string): boolean => TOKEN.test(value.trim());

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The closed codes the renewal can fail with; any other one is said as `other`. */
export const RENEW_FAILURES = [
  "token_malformed",
  "token_rejected",
  "token_other_account",
  "cloud_unreachable",
  "cloud_not_configured",
  "cloud_write_failed",
  "cloud_token_read_only",
  "existing_team_runtime_outdated",
  "existing_team_runtime_target_changed",
  "browser_failed",
] as const;
export type RenewFailure = (typeof RENEW_FAILURES)[number] | "other";

function failureOf(reply: unknown): RenewFailure {
  const code = isRecord(reply) ? reply.error : undefined;
  return (RENEW_FAILURES as readonly unknown[]).includes(code) ? (code as RenewFailure) : "other";
}

export type CloudTokenCheck =
  /** The website refuses the box's token. */
  | { kind: "expired" }
  /** It is accepted and ends within the website's warning window (14 days). */
  | { kind: "expiring"; expiresAt: string; daysLeft: number }
  /** Accepted, not about to end (or no expiry, or the website does not say). */
  | { kind: "fine" }
  /** Not told: an image without the script, an unreachable website, a read that failed. */
  | { kind: "unknown" };

/** Asks the team's box how long its current token lasts. Reads, writes nothing. */
export async function checkCloudToken(
  call: (request: Record<string, unknown>) => Promise<unknown> = (request) => invoke<unknown>(COMMAND, { request }),
): Promise<CloudTokenCheck> {
  try {
    const reply = await call({ op: "check" });
    if (!isRecord(reply) || reply.ok !== true) return { kind: "unknown" };
    if (reply.state === "expired") return { kind: "expired" };
    if (reply.state === "expiring") {
      const { expires_at: expiresAt, days_left: daysLeft } = reply;
      if (typeof expiresAt === "string" && typeof daysLeft === "number" && Number.isInteger(daysLeft) && daysLeft >= 0) {
        return { kind: "expiring", expiresAt, daysLeft };
      }
      return { kind: "unknown" };
    }
    return reply.state === "active" || reply.state === "none" || reply.state === "unknown" ? { kind: "fine" } : { kind: "unknown" };
  } catch {
    return { kind: "unknown" };
  }
}

export type RenewResult = { ok: true } | { ok: false; failure: RenewFailure };

/**
 * Hands the new token to the box. The native side wants the connection key of the team the page
 * shows (the same one the position writes carry) and refuses a team that is not connected in full:
 * a read-only view never writes on the box.
 */
export async function renewCloudToken(
  token: string,
  call: (command: string, args?: Record<string, unknown>) => Promise<unknown> = (command, args) => invoke<unknown>(command, args),
): Promise<RenewResult> {
  const secret = token.trim();
  if (!isSyncToken(secret)) return { ok: false, failure: "token_malformed" };
  try {
    const target = await call(TARGET);
    if (!isRecord(target) || target.ok !== true || typeof target.connectionKey !== "string") {
      return { ok: false, failure: target && isRecord(target) && target.error === "position_write_read_only" ? "cloud_token_read_only" : failureOf(target) };
    }
    const reply = await call(COMMAND, { request: { op: "apply", token: secret, connectionKey: target.connectionKey } });
    return isRecord(reply) && reply.ok === true ? { ok: true } : { ok: false, failure: failureOf(reply) };
  } catch {
    return { ok: false, failure: "other" };
  }
}

/** Opens the website's token page in the default browser. The page names no address. */
export async function openCloudTokenSite(
  call: (command: string) => Promise<unknown> = (command) => invoke<unknown>(command),
): Promise<RenewResult> {
  try {
    const reply = await call(OPEN_SITE);
    return isRecord(reply) && reply.ok === true ? { ok: true } : { ok: false, failure: failureOf(reply) };
  } catch {
    return { ok: false, failure: "other" };
  }
}
