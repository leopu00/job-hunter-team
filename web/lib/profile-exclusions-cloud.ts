import type { SupabaseClient } from "@supabase/supabase-js";
import { DOOR_REFUSAL_STATUS, callDoor } from "@/lib/door-rpc";

// The user's decision on a proposal to exclude a kind of position (JHT-T05, JHT-T24, mig 094), written on
// Supabase with the client one has: the user's session, on the website's server or in the desktop app.
// No Next, SQLite or fs here, so the desktop imports it too.
//
// The decision is written by the single door (`exclusion.profile_set`, migration 101): after it,
// profile_exclusions is read only for a browser role.

export const PROFILE_EXCLUSION_COLUMNS =
  "reason, status, positions_at_decision, decided_at";

export type ProfileDecisionResult =
  | { ok: true; exclusion: Record<string, unknown> }
  | { ok: false; status: number; error: string };

export async function decideProfileExclusion(
  supabase: SupabaseClient,
  userId: string,
  reason: string,
  status: "accepted" | "dismissed",
  positions: number,
): Promise<ProfileDecisionResult> {
  const door = await callDoor(supabase, {
    action: "exclusion.profile_set",
    level: "L1",
    params: { reason, status, positions },
  });
  if (door.kind === "door_missing") {
    // TEMPORARY (O1, 22/10): the database does not have 101 yet. The way of before, which 101 itself
    // closes: after the migration this branch never opens again, and it is removed.
    const { data, error } = await supabase
      .from("profile_exclusions")
      .upsert(
        {
          user_id: userId,
          reason,
          status,
          positions_at_decision: positions,
          decided_at: new Date().toISOString(),
        },
        { onConflict: "user_id,reason" },
      )
      .select(PROFILE_EXCLUSION_COLUMNS)
      .single();
    if (error || !data) {
      console.error("[profile-exclusions] 500 upsert_failed");
      return { ok: false, status: 500, error: "query_failed" };
    }
    return { ok: true, exclusion: data as Record<string, unknown> };
  }
  if (door.kind === "failed") {
    console.error("[profile-exclusions] 502 door_failed");
    return { ok: false, status: 502, error: "action_failed" };
  }
  if (door.kind === "refused") {
    return {
      ok: false,
      status: DOOR_REFUSAL_STATUS[door.error] ?? 500,
      error: door.error,
    };
  }
  const { data, error } = await supabase
    .from("profile_exclusions")
    .select(PROFILE_EXCLUSION_COLUMNS)
    .eq("user_id", userId)
    .eq("reason", reason)
    .maybeSingle();
  if (error || !data) {
    console.error("[profile-exclusions] 500 reread_failed");
    return { ok: false, status: 500, error: "query_failed" };
  }
  return { ok: true, exclusion: data as Record<string, unknown> };
}
