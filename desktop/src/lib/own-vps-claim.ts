import { invoke } from "@tauri-apps/api/core";
import { teamStatusErrorCode } from "./existing-team-status";

/**
 * «This VPS is mine» (native command own_vps_claim, existing_team_runtime.rs). For a VPS the app set up
 * before it started to mark them: the person confirms it in the page's dialog, and the native side checks
 * with the VPS itself that it answers as this account's team before it writes the mark. The page sends
 * the account's id and the confirmation, never a host, a key or a path.
 */
const COMMAND = "own_vps_claim";

/** The two codes that mean «this VPS needs the person's claim to be written to». */
export const OWN_VPS_CLAIM_CODES = ["own_vps_claim_required", "own_vps_key_changed"] as const;
export type OwnVpsClaimCode = (typeof OWN_VPS_CLAIM_CODES)[number];

export function isOwnVpsClaimCode(code: unknown): code is OwnVpsClaimCode {
  return typeof code === "string" && (OWN_VPS_CLAIM_CODES as readonly string[]).includes(code);
}

export type OwnVpsState = "marked" | "claimable" | "key_changed" | "not_own";

/** The state the agents list reports, or null when the list does not say (this computer, an existing team). */
export function pickOwnVpsState(value: unknown): OwnVpsState | null {
  return value === "marked" || value === "claimable" || value === "key_changed" || value === "not_own" ? value : null;
}

/** Only after the person confirmed it in the dialog. */
export async function claimOwnVps(userId: string): Promise<{ ok: true } | { ok: false; code: string }> {
  try {
    await invoke<unknown>(COMMAND, { request: { userId, confirmed: true } });
    return { ok: true };
  } catch (error) {
    return { ok: false, code: teamStatusErrorCode(error) };
  }
}
