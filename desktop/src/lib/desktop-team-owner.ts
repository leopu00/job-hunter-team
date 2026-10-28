import { invoke, isTauri } from "@tauri-apps/api/core";

export interface DesktopTeamOwnerIdentity {
  kind: "local" | "google";
  profileId?: string;
}

const DIGEST = /^[a-f0-9]{64}$/;

/**
 * Who owns the team of this computer, as the owner marker says: a local profile (then that profile's id) or an
 * account that signed in, or null when nobody owns it yet. Read-only; no digest crosses.
 */
export async function readDesktopTeamOwnerIdentity(): Promise<DesktopTeamOwnerIdentity | null> {
  if (!isTauri()) throw { code: "desktop_only" };
  const reply = await invoke<DesktopTeamOwnerIdentity | null>("runtime_local_team_owner_identity");
  if (reply === null) return null;
  if (
    !reply ||
    (reply.kind !== "local" && reply.kind !== "google") ||
    (reply.kind === "local" ? typeof reply.profileId !== "string" || !DIGEST.test(reply.profileId) : reply.profileId !== undefined)
  ) {
    throw { code: "local_account_owner_invalid" };
  }
  return reply.kind === "local" ? { kind: "local", profileId: reply.profileId } : { kind: "google" };
}
