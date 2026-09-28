import type { SupabaseClient } from "@supabase/supabase-js";
import { isChatAgent } from "@/lib/chat-agents";
import type { PendingMessage } from "@/lib/types";

/**
 * The agents page's data, read from the cloud with the user's own session
 * (RLS scopes every row). Only what the cloud really has:
 *  - team_state: the team's heartbeat, running flag, last action and error,
 *    and agents_enabled (the per-role wish; usually empty);
 *  - position_transitions: each agent's moves (by_agent = the instance,
 *    scout-1, analista-2…);
 *  - pending_user_messages: the chats, which exist for three agents only
 *    (web/lib/chat-agents.ts).
 * Model, provider, CPU, RAM and tokens per agent never reach the cloud:
 * the page shows «—» for them.
 */

export type AgentRole =
  | "capitano"
  | "scout"
  | "analista"
  | "scorer"
  | "scrittore"
  | "critico"
  | "sentinella"
  | "assistente"
  | "mentor";

export type AgentDef = {
  role: AgentRole;
  name: string;
  emoji: string;
  color: string;
  /** the web page of the role, when it has one */
  page: string | null;
  /** whether the user chats with it (pending_user_messages) */
  chat: boolean;
};

// Names, emoji and colours of the web's /api/team/status (JH_AGENTS), plus
// the two chat-only figures with the colours of web/lib/message-display.ts.
export const AGENTS: AgentDef[] = (
  [
  { role: "capitano", name: "Capitano", emoji: "👨‍✈️", color: "#ff9100", page: "/team" },
  { role: "scout", name: "Scout", emoji: "🕵️", color: "#2196f3", page: "/team/scout" },
  { role: "analista", name: "Analista", emoji: "🔬", color: "#00e676", page: "/team/analista" },
  { role: "scorer", name: "Scorer", emoji: "📊", color: "#b388ff", page: "/team/scorer" },
  { role: "scrittore", name: "Scrittore", emoji: "✍️", color: "#ffd600", page: "/team/scrittore" },
  { role: "critico", name: "Critico", emoji: "⚖️", color: "#f44336", page: "/team/critico" },
  { role: "sentinella", name: "Sentinella", emoji: "🛡️", color: "#607d8b", page: null },
  { role: "assistente", name: "Assistente", emoji: "👩‍💼", color: "var(--color-blue)", page: null },
  { role: "mentor", name: "Mentor", emoji: "🧙‍♂️", color: "var(--color-purple)", page: null },
  ] as Omit<AgentDef, "chat">[]
).map((a) => ({ ...a, chat: isChatAgent(a.role) }));

export type TeamStatus = {
  isRunning: boolean;
  heartbeatAt: string | null;
  lastAction: string | null;
  lastActionAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  /** agents_enabled as the user set it; a role missing from it is «not said» */
  enabled: Record<string, boolean>;
};

export type AgentMove = {
  ts: string;
  /** the instance that moved it: scout-1, analista-2… */
  actor: string;
  from: string | null;
  to: string | null;
  /** the position's uuid, for its link; null when the position is not on the cloud */
  positionId: string | null;
  legacyId: number;
  title: string | null;
  company: string | null;
};

export type AgentsData = {
  /** null: the team never wrote its state on the cloud */
  team: TeamStatus | null;
  moves: Record<AgentRole, AgentMove[]>;
  messages: PendingMessage[];
};

/** The moves per role the page lists: the latest ones. */
export const MOVES_PER_ROLE = 30;
/** The chat history, as the web's Messaggi page reads it (getMessagesHistory(200)). */
export const MESSAGES_LIMIT = 200;
/**
 * The heartbeat a live team writes every 30 s; older than this it is stale,
 * the same threshold as web/app/api/team-state/claim/route.ts.
 */
export const HEARTBEAT_STALE_MS = 5 * 60 * 1000;

// The select of web/lib/queries.ts getMessagesHistory (cloud branch).
export const MESSAGES_SELECT =
  "id, agent, body, kind, author, related_position_id, delivered_via, delivered_at, " +
  "acknowledged_at, user_reply, user_reply_at, agent_seen_reply_at, created_at";

const TEAM_SELECT =
  "is_running, last_heartbeat_at, last_action, last_action_at, last_error, last_error_at, agents_enabled";

type Client = Pick<SupabaseClient, "from" | "auth">;

/** The user's own rows only: user_id on every query, on top of the RLS (as the other desktop pages). */
export async function loadAgents(client: Client): Promise<AgentsData> {
  const { data } = await client.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) throw new Error("nessuna sessione");
  const [team, moves, messages] = await Promise.all([
    readTeam(client, userId),
    readMoves(client, userId),
    readMessages(client, userId),
  ]);
  return { team, moves, messages };
}

async function readTeam(client: Client, userId: string): Promise<TeamStatus | null> {
  const { data, error } = await client.from("team_state").select(TEAM_SELECT).eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as Record<string, unknown>;
  const enabled: Record<string, boolean> = {};
  const raw = row.agents_enabled;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [role, value] of Object.entries(raw)) if (typeof value === "boolean") enabled[role] = value;
  }
  const text = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    isRunning: row.is_running === true,
    heartbeatAt: text(row.last_heartbeat_at),
    lastAction: text(row.last_action),
    lastActionAt: text(row.last_action_at),
    lastError: text(row.last_error),
    lastErrorAt: text(row.last_error_at),
    enabled,
  };
}

type TransitionRow = {
  position_legacy_id: number;
  from_state: string | null;
  to_state: string | null;
  ts: string;
  by_agent: string;
};

async function readMoves(client: Client, userId: string): Promise<Record<AgentRole, AgentMove[]>> {
  const perRole = await Promise.all(
    AGENTS.map(async ({ role }) => {
      // by_agent is the instance (scout-1) or, for a single one, the role itself.
      const { data, error } = await client
        .from("position_transitions")
        .select("position_legacy_id, from_state, to_state, ts, by_agent")
        .eq("user_id", userId)
        .or(`by_agent.eq.${role},by_agent.like.${role}-*`)
        .order("ts", { ascending: false })
        .limit(MOVES_PER_ROLE);
      if (error) throw new Error(error.message);
      return [role, (data ?? []) as TransitionRow[]] as const;
    }),
  );
  const legacyIds = [...new Set(perRole.flatMap(([, rows]) => rows.map((r) => r.position_legacy_id)))];
  const positions = await readPositions(client, legacyIds, userId);
  const moves = {} as Record<AgentRole, AgentMove[]>;
  for (const [role, rows] of perRole) {
    moves[role] = rows.map((r) => {
      const p = positions.get(r.position_legacy_id);
      return {
        ts: r.ts,
        actor: r.by_agent,
        from: r.from_state,
        to: r.to_state,
        positionId: p?.id ?? null,
        legacyId: r.position_legacy_id,
        title: p?.title ?? null,
        company: p?.company ?? null,
      };
    });
  }
  return moves;
}

type PositionMeta = { id: string; title: string | null; company: string | null };

/** legacy_id → the position's uuid and title, as web/lib/queries.ts enrichRecent resolves them; the user's rows only. */
export async function readPositions(client: Pick<SupabaseClient, "from">, legacyIds: number[], userId: string): Promise<Map<number, PositionMeta>> {
  const out = new Map<number, PositionMeta>();
  for (let i = 0; i < legacyIds.length; i += 150) {
    const chunk = legacyIds.slice(i, i + 150);
    const { data, error } = await client.from("positions").select("id, legacy_id, title, company").eq("user_id", userId).in("legacy_id", chunk);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as Array<{ id: string; legacy_id: number | null; title: string | null; company: string | null }>) {
      if (r.legacy_id != null) out.set(r.legacy_id, { id: String(r.id), title: r.title, company: r.company });
    }
  }
  return out;
}

async function readMessages(client: Client, userId: string): Promise<PendingMessage[]> {
  const { data, error } = await client
    .from("pending_user_messages")
    .select(MESSAGES_SELECT)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(MESSAGES_LIMIT);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as PendingMessage[];
}

export type Led = "on" | "stale" | "off" | "unknown";

/**
 * The led of an agent. The cloud knows the team, not the single agent: on
 * when the team runs with a fresh heartbeat and the role is not switched off
 * in agents_enabled; stale when the heartbeat is old; off when the team is
 * stopped or the role is disabled.
 */
export function agentLed(team: TeamStatus | null, role: AgentRole, now: number): Led {
  if (!team) return "unknown";
  if (team.enabled[role] === false) return "off";
  if (!team.isRunning) return "off";
  const beat = team.heartbeatAt ? Date.parse(team.heartbeatAt) : NaN;
  if (Number.isNaN(beat) || now - beat > HEARTBEAT_STALE_MS) return "stale";
  return "on";
}

/** The latest thing an agent did that the cloud knows: its newest move or chat message. */
export function lastActivity(data: AgentsData, role: AgentRole): string | null {
  const move = data.moves[role]?.[0]?.ts ?? null;
  const message =
    data.messages.find((m) => m.agent === role && m.author !== "user")?.created_at ?? null;
  if (!move) return message;
  if (!message) return move;
  return Date.parse(move) >= Date.parse(message) ? move : message;
}

/** The chat with one agent, oldest first. */
export function threadOf(messages: PendingMessage[], role: AgentRole): PendingMessage[] {
  return messages.filter((m) => m.agent === role).sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** Unread = the agent's turns not acknowledged yet (the user's own are born read). */
export function unreadCount(messages: PendingMessage[], role: AgentRole): number {
  return messages.filter((m) => m.agent === role && m.author !== "user" && !m.acknowledged_at).length;
}
