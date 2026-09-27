import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentStatus, AgentStatuses } from "./contract";

/**
 * Each agent's status as the box publishes it (team_state.agents_status,
 * migration 089), for the tags over the agents. One entry per source, each
 * with the time the database stamped it: "tui" (cli/src/lib/agents-status.js,
 * the Godot game's rule on the tmux panes) and "api" (agents-status-traces.js,
 * the JHT API executor's traces). Keys are already the TUI session names
 * (capitano, scout-1): the producers normalise them.
 *
 * Its own query, apart from the office's snapshot: until migration 089 is
 * on the cloud the column does not exist, PostgREST refuses the select, and
 * that must cost the tags only, not the office. Any failure = no statuses.
 * The user's own row: the session's user_id on top of the RLS.
 */

/** Older than this, a source's map is not the present: no tags from it. */
export const STATUS_STALE_MS = 2 * 60 * 1000;

const STATUSES = new Set(["working", "idle", "paused", "throttled"]);

type Client = Pick<SupabaseClient, "from" | "auth">;

export type StatusRow = { agents_status?: unknown };

export async function loadAgentStatuses(client: Client, now = Date.now()): Promise<AgentStatuses | null> {
  try {
    const { data: sessionData } = await client.auth.getSession();
    const userId = sessionData.session?.user.id;
    if (!userId) return null;
    const { data, error } = await client
      .from("team_state")
      .select("agents_status")
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !data) return null;
    return parseAgentStatuses(data as StatusRow, now);
  } catch {
    return null;
  }
}

/**
 * The statuses to draw, or null. A source whose "at" is missing or older than
 * STATUS_STALE_MS is left out (no tags from it); none fresh = null. An entry
 * with an unknown status is left out (a producer may learn a new word before
 * the desktop). An agent in two fresh sources takes the newer one.
 */
export function parseAgentStatuses(row: StatusRow, now = Date.now()): AgentStatuses | null {
  const raw = row.agents_status;
  if (!isObject(raw)) return null;
  const agents: Record<string, AgentStatus> = {};
  const seenAt: Record<string, number> = {};
  let newest = NaN;
  for (const source of Object.values(raw)) {
    if (!isObject(source) || !isObject(source.agents)) continue;
    const at = typeof source.at === "string" ? Date.parse(source.at) : NaN;
    if (Number.isNaN(at) || now - at > STATUS_STALE_MS) continue;
    newest = Number.isNaN(newest) ? at : Math.max(newest, at);
    for (const [name, value] of Object.entries(source.agents)) {
      if (!isObject(value) || typeof value.status !== "string" || !STATUSES.has(value.status)) continue;
      const uid = name.toLowerCase();
      if (seenAt[uid] !== undefined && seenAt[uid] >= at) continue;
      const entry: AgentStatus = { status: value.status as AgentStatus["status"] };
      if (value.status === "throttled" && typeof value.throttle_left_s === "number" && value.throttle_left_s >= 0)
        entry.throttleUntil = at + value.throttle_left_s * 1000;
      agents[uid] = entry;
      seenAt[uid] = at;
    }
  }
  return Number.isNaN(newest) ? null : { at: newest, agents };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** The tag's text and colour, AgentStateTag._label/_color. */
export function tagOf(s: AgentStatus, now = Date.now()): { label: string; color: number } {
  switch (s.status) {
    case "working":
      return { label: "WORKING", color: 0x58e68b };
    case "paused":
      return { label: "PAUSED", color: 0xff7a65 };
    case "throttled": {
      // the JHT API's pause has no known length: no clock rather than an invented one
      if (s.throttleUntil == null) return { label: "THROTTLED", color: 0xf5c518 };
      const left = Math.max(0, Math.ceil((s.throttleUntil - now) / 1000));
      return { label: `THROTTLED  ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`, color: 0xf5c518 };
    }
    default:
      return { label: "WAITING", color: 0x7a7a96 };
  }
}
