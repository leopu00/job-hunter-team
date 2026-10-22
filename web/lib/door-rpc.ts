import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The single door (`request_action`, migrations 098-099-101) called with the client one has: the user's
 * session, on the website's server or in the desktop app. No Next, no SQLite, no fs here, so the desktop
 * imports it too.
 *
 * Only the database decides: the user (auth.uid()), the vocabulary, the parameters, the limits, the
 * confirmation in two steps and the effect. This function passes the action fixed by its caller, the
 * parameters, the free text (first call only) or the id of the confirmation, and reads the answer.
 *
 * TEMPORARY (decision of 22/10, «O1»): `door_missing` says the database cannot do this action yet: the
 * door is not there (PostgREST PGRST202, PostgreSQL 42883) or does not know the action (`unknown_action`,
 * migration 101 not applied). Only then a caller may take its old way; after 101 the old ways are revoked
 * in the database, so the fallback goes quiet by itself, and it is removed with the next release.
 */

export type DoorLevel = "L1" | "L2" | "L3";

export interface DoorCall {
  /** Fixed by the caller, never by the client. */
  action: string;
  /** The level the caller declares; the database refuses a lower one. */
  level: DoorLevel;
  /** First call: the closed parameters of the action. */
  params?: Record<string, unknown>;
  /** First call: the free text, for the actions that take one. */
  body?: string | null;
  /** Second call: the id the first one answered. */
  confirmId?: string | null;
}

export type DoorResult =
  | {
      kind: "ok";
      state: "awaiting_confirm" | "queued" | "done";
      id: string;
      summary: string;
      expiresAt: string | null;
    }
  | { kind: "refused"; error: string }
  | { kind: "door_missing" }
  | { kind: "failed" };

/** The codes of the door and the HTTP answer of each; anything else is a failure of the server. */
export const DOOR_REFUSAL_STATUS: Record<string, number> = {
  unauthenticated: 401,
  reauth_required: 401,
  rate_limited: 429,
  invalid_params: 400,
  not_found: 404,
  confirm_not_found: 404,
  confirm_expired: 410,
  confirm_used: 409,
  confirm_session_mismatch: 409,
  confirm_action_mismatch: 409,
  level_mismatch: 500,
  position_not_ready: 409,
  already_submitted: 409,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isDoorMissingError(error: unknown): boolean {
  const code =
    error && typeof error === "object"
      ? (error as Record<string, unknown>).code
      : undefined;
  return code === "PGRST202" || code === "42883";
}

export async function callDoor(
  client: Pick<SupabaseClient, "rpc">,
  call: DoorCall,
): Promise<DoorResult> {
  const confirming = typeof call.confirmId === "string";
  if (confirming && !UUID.test(call.confirmId as string)) {
    return { kind: "refused", error: "confirm_not_found" };
  }
  let result: { data: unknown; error: unknown };
  try {
    result = await client.rpc("request_action", {
      p_action: call.action,
      p_params: confirming ? {} : (call.params ?? {}),
      p_confirm_id: confirming
        ? (call.confirmId as string).toLowerCase()
        : null,
      p_route_level: call.level,
      // The text goes with the first call only: at the confirmation the database has the saved one.
      ...(!confirming && typeof call.body === "string"
        ? { p_body: call.body }
        : {}),
    });
  } catch {
    return { kind: "failed" };
  }
  if (result.error) {
    return isDoorMissingError(result.error)
      ? { kind: "door_missing" }
      : { kind: "failed" };
  }
  const d = result.data as Record<string, unknown> | null;
  if (!d || typeof d !== "object") return { kind: "failed" };
  if (d.ok === false) {
    const code = typeof d.error === "string" ? d.error : "";
    if (code === "unknown_action") return { kind: "door_missing" };
    return Object.prototype.hasOwnProperty.call(DOOR_REFUSAL_STATUS, code)
      ? { kind: "refused", error: code }
      : { kind: "failed" };
  }
  if (d.ok !== true) return { kind: "failed" };
  const state = d.state;
  if (state !== "awaiting_confirm" && state !== "queued" && state !== "done") {
    return { kind: "failed" };
  }
  if (confirming && state === "awaiting_confirm") return { kind: "failed" };
  if (typeof d.id !== "string" || !UUID.test(d.id)) return { kind: "failed" };
  const summary = typeof d.summary === "string" ? d.summary.slice(0, 400) : "";
  const expiresAt =
    typeof d.expires_at === "string" && !Number.isNaN(Date.parse(d.expires_at))
      ? d.expires_at
      : null;
  if (state === "awaiting_confirm" && (summary.trim() === "" || !expiresAt)) {
    return { kind: "failed" };
  }
  return { kind: "ok", state, id: d.id.toLowerCase(), summary, expiresAt };
}
