import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentStatus, AgentStatuses } from "./contract";

/**
 * Each agent's status as the box publishes it (team_state.agents_status,
 * migration 089, written by cli/src/lib/agents-status.js with the Godot
 * game's rule), for the tags over the agents.
 *
 * Its own query, apart from the office's snapshot: until migration 089 is
 * on the cloud the columns do not exist, PostgREST refuses the select, and
 * that must cost the tags only, not the office. Any failure = no statuses.
 * The user's own row: the session's user_id on top of the RLS.
 */

/** Older than this, the map is not the present: no tags. */
export const STATUS_STALE_MS = 2 * 60 * 1000;

const STATUSES = new Set(["working", "idle", "paused", "throttled"]);

type Client = Pick<SupabaseClient, "from" | "auth">;

export type StatusRow = { agents_status?: unknown; agents_status_at?: unknown };

export async function loadAgentStatuses(client: Client, now = Date.now()): Promise<AgentStatuses | null> {
  try {
    const { data: sessionData } = await client.auth.getSession();
    const userId = sessionData.session?.user.id;
    if (!userId) return null;
    const { data, error } = await client
      .from("team_state")
      .select("agents_status, agents_status_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !data) return null;
    return parseAgentStatuses(data as StatusRow, now);
  } catch {
    return null;
  }
}

/**
 * The map to draw, or null. A map older than STATUS_STALE_MS, a missing
 * stamp or a value that is not an object is null; an entry with an unknown
 * status is left out (the producer may learn a new word before the desktop).
 */
export function parseAgentStatuses(row: StatusRow, now = Date.now()): AgentStatuses | null {
  const at = typeof row.agents_status_at === "string" ? Date.parse(row.agents_status_at) : NaN;
  if (Number.isNaN(at) || now - at > STATUS_STALE_MS) return null;
  const raw = row.agents_status;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const agents: Record<string, AgentStatus> = {};
  for (const [uid, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    if (typeof v.status !== "string" || !STATUSES.has(v.status)) continue;
    const entry: AgentStatus = { status: v.status as AgentStatus["status"] };
    if (v.status === "throttled" && typeof v.throttle_left_s === "number" && v.throttle_left_s >= 0)
      entry.throttleUntil = at + v.throttle_left_s * 1000;
    agents[uid.toLowerCase()] = entry;
  }
  return { at, agents };
}

/** The tag's text and colour, AgentStateTag._label/_color. */
export function tagOf(s: AgentStatus, now = Date.now()): { label: string; color: number } {
  switch (s.status) {
    case "working":
      return { label: "WORKING", color: 0x58e68b };
    case "paused":
      return { label: "PAUSED", color: 0xff7a65 };
    case "throttled": {
      const left = s.throttleUntil == null ? 0 : Math.max(0, Math.ceil((s.throttleUntil - now) / 1000));
      return { label: `THROTTLED  ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`, color: 0xf5c518 };
    }
    default:
      return { label: "WAITING", color: 0x7a7a96 };
  }
}
