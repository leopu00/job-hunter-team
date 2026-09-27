import type { SupabaseClient } from "@supabase/supabase-js";
import { AGENTS, HEARTBEAT_STALE_MS, readPositions } from "../../pages/agents/load-agents";
import type { AgentRole, OfficeAgent, OfficeSnapshot, Piles } from "../contract";

/**
 * The office's snapshot, read from the cloud with the user's own session
 * (RLS scopes every row). Only what exists (D03):
 *  - team_state: is the team running, with a fresh heartbeat;
 *  - position_transitions: who moved which position, the roster's source;
 *  - positions (+ applications): the counts on the handoff piles.
 * The tmux roster never reaches the cloud: an agent is in the office when
 * it moved a position in the last 24 h, and the core roles when the team
 * is online.
 */

/** How far back a by_agent keeps its seat in the office. */
export const ROSTER_WINDOW_MS = 24 * 60 * 60 * 1000;
/** The newest transitions read per snapshot (PostgREST's default page). */
export const TRANSITIONS_LIMIT = 1000;
/** The roles with a core seat that work without moving positions: in the office while the team runs. */
export const CORE_ROLES: readonly AgentRole[] = ["capitano", "sentinella", "assistente", "mentor"];

const ROLE_ORDER = AGENTS.map((a) => a.role as AgentRole);

type Client = Pick<SupabaseClient, "from">;

type TransitionRow = {
  position_legacy_id: number;
  from_state: string | null;
  to_state: string | null;
  ts: string;
  by_agent: string | null;
};

/** A by_agent as an office agent: `scout-2` or `capitano`; null for anything else (`unstuck`, `user`…). */
export function agentOf(byAgent: string): { role: AgentRole; n: number } | null {
  const m = /^([a-z]+)(?:-(\d+))?$/.exec(byAgent);
  if (!m) return null;
  const role = m[1] as AgentRole;
  if (!ROLE_ORDER.includes(role)) return null;
  const n = m[2] === undefined ? 1 : Number(m[2]);
  return n >= 1 ? { role, n } : null;
}

export async function loadOfficeSnapshot(client: Client, now: number = Date.now()): Promise<OfficeSnapshot> {
  const since = new Date(now - ROSTER_WINDOW_MS).toISOString();
  const [team, rows, piles] = await Promise.all([readTeam(client), readTransitions(client, since), readPiles(client)]);
  const positions = await readPositions(client, [...new Set(rows.map((r) => r.position_legacy_id))]);

  const beat = team?.heartbeatAt ? Date.parse(team.heartbeatAt) : NaN;
  const teamOnline = team ? team.isRunning && !Number.isNaN(beat) && now - beat <= HEARTBEAT_STALE_MS : null;

  const byUid = new Map<string, { role: AgentRole; n: number }>();
  for (const r of rows) {
    const who = r.by_agent ? agentOf(r.by_agent) : null;
    if (who) byUid.set(r.by_agent!, who);
  }
  if (teamOnline) for (const role of CORE_ROLES) if (!byUid.has(role)) byUid.set(role, { role, n: 1 });
  const roster: OfficeAgent[] = [...byUid]
    .sort(([ua, a], [ub, b]) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.n - b.n || ua.localeCompare(ub))
    .map(([uid, { role }]) => ({ uid, role, sheet: "" }));

  return {
    teamOnline,
    heartbeatAt: team?.heartbeatAt ?? null,
    roster,
    piles,
    transitions: rows.map((r) => {
      const p = positions.get(r.position_legacy_id);
      return {
        ts: r.ts,
        byAgent: r.by_agent ?? "",
        from: r.from_state,
        to: r.to_state,
        position: { id: p?.id ?? null, legacyId: r.position_legacy_id, title: p?.title ?? null, company: p?.company ?? null },
      };
    }),
  };
}

async function readTeam(client: Client): Promise<{ isRunning: boolean; heartbeatAt: string | null } | null> {
  const { data, error } = await client.from("team_state").select("is_running, last_heartbeat_at").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as { is_running?: unknown; last_heartbeat_at?: unknown };
  return {
    isRunning: row.is_running === true,
    heartbeatAt: typeof row.last_heartbeat_at === "string" && row.last_heartbeat_at ? row.last_heartbeat_at : null,
  };
}

async function readTransitions(client: Client, since: string): Promise<TransitionRow[]> {
  const { data, error } = await client
    .from("position_transitions")
    .select("position_legacy_id, from_state, to_state, ts, by_agent")
    .gte("ts", since)
    .order("ts", { ascending: false })
    .limit(TRANSITIONS_LIMIT);
  if (error) throw new Error(error.message);
  return (data ?? []) as TransitionRow[];
}

/**
 * The piles as game/scripts/office/pipeline_queue_defs.gd counts them, on
 * the positions not deleted: Scout = new; Analisti = checked; Scorer =
 * scored the user did not ask to write; Scrittori = review, and ready
 * without the critic's PASS; Critici = ready with the PASS (the output
 * shelf). Counted by PostgREST (head requests), no rows downloaded.
 */
async function readPiles(client: Client): Promise<Piles> {
  const count = async (query: PromiseLike<{ count: number | null; error: { message: string } | null }>) => {
    const { count: n, error } = await query;
    if (error) throw new Error(error.message);
    return n ?? 0;
  };
  const positions = () => client.from("positions").select("id", { count: "exact", head: true }).is("deleted_at", null);
  const [scout, analisti, scorer, review, ready, passed] = await Promise.all([
    count(positions().eq("status", "new")),
    count(positions().eq("status", "checked")),
    count(positions().eq("status", "scored").eq("write_requested", false)),
    count(positions().eq("status", "review")),
    count(positions().eq("status", "ready")),
    count(
      client
        .from("positions")
        .select("id, applications!inner(id)", { count: "exact", head: true })
        .is("deleted_at", null)
        .eq("status", "ready")
        .ilike("applications.critic_verdict", "pass")
        .is("applications.deleted_at", null),
    ),
  ]);
  return { scout, analisti, scorer, scrittori: review + Math.max(0, ready - passed), critici: passed };
}
