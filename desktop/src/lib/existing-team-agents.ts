import { invoke } from "@tauri-apps/api/core";
import { isAgentState, isKnownReason, type AgentStateInfo } from "@/lib/agent-state";
import { teamStatusErrorCode } from "./existing-team-status";

/**
 * The agents of an existing team, read over its VPS by a fixed native command
 * (existing_team_agents.rs). The renderer sends the operation and, for a
 * terminal, a session name taken from the list: never a host, a container or a
 * command. Nothing here writes to the team.
 */
const COMMAND = "existing_team_agents_read";

export type TeamAgent = {
  name: string;
  role: string;
  instance: string | null;
  /** epoch s */
  created: number | null;
  /** the session's last activity, epoch s */
  activity: number | null;
  /** what agent_state.py says, or "sconosciuto" when the VPS does not say it */
  state: AgentStateInfo;
};

export type TeamRole = { role: string; multi: boolean };

export type TeamAgentsRead = { agents: TeamAgent[]; roles: TeamRole[]; statesKnown: boolean };

export type TeamAgentsReading =
  | { kind: "unknown" }
  | { kind: "read"; at: number; read: TeamAgentsRead }
  | { kind: "error"; at: number; code: string };

export type AgentScreenReading =
  | { kind: "read"; at: number; up: true; text: string }
  | { kind: "read"; at: number; up: false; text: null }
  | { kind: "error"; at: number; code: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const SESSION = /^[A-Z][A-Z0-9-]{0,39}$/;
const epoch = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null);

function pickAgent(value: unknown, statesKnown: boolean): TeamAgent | null {
  if (!isRecord(value) || typeof value.name !== "string" || !SESSION.test(value.name)) return null;
  if (typeof value.role !== "string") return null;
  // The state is the team's own computation, or unknown: never inferred from a live session.
  const state: AgentStateInfo = { state: "sconosciuto" };
  if (statesKnown && isAgentState(value.state)) {
    state.state = value.state;
    if (isKnownReason(value.reason)) state.reason = value.reason;
    const since = epoch(value.since);
    const until = epoch(value.until);
    if (since !== null) state.since = since * 1000;
    if (until !== null) state.until = until * 1000;
  }
  return {
    name: value.name,
    role: value.role,
    instance: typeof value.instance === "string" ? value.instance : null,
    created: epoch(value.created),
    activity: epoch(value.activity),
    state,
  };
}

export function pickAgentsRead(data: unknown): TeamAgentsRead | null {
  if (!isRecord(data) || !Array.isArray(data.agents) || !Array.isArray(data.roles) || typeof data.states !== "boolean") {
    return null;
  }
  const statesKnown = data.states;
  const agents = data.agents.map((agent) => pickAgent(agent, statesKnown));
  if (agents.some((agent) => agent === null)) return null;
  const roles = data.roles.filter(
    (role): role is TeamRole => isRecord(role) && typeof role.role === "string" && typeof role.multi === "boolean",
  );
  return { agents: agents as TeamAgent[], roles, statesKnown };
}

export async function readTeamAgents(
  read: () => Promise<unknown> = () => invoke<unknown>(COMMAND, { request: { op: "list" } }),
  now: () => number = Date.now,
): Promise<TeamAgentsReading> {
  try {
    const reply = await read();
    if (!isRecord(reply)) return { kind: "error", at: now(), code: "desktop_bad_reply" };
    if (reply.ok === false) return { kind: "error", at: now(), code: teamStatusErrorCode(reply.error) };
    const picked = reply.ok === true ? pickAgentsRead(reply.data) : null;
    return picked ? { kind: "read", at: now(), read: picked } : { kind: "error", at: now(), code: "desktop_bad_reply" };
  } catch (error) {
    return { kind: "error", at: now(), code: teamStatusErrorCode(error) };
  }
}

/** The last lines of one agent's terminal, read once when the person opens it. */
export async function readAgentScreen(
  name: string,
  read: (name: string) => Promise<unknown> = (session) =>
    invoke<unknown>(COMMAND, { request: { op: "screen", name: session } }),
  now: () => number = Date.now,
): Promise<AgentScreenReading> {
  if (!SESSION.test(name)) return { kind: "error", at: now(), code: "agents_unavailable" };
  try {
    const reply = await read(name);
    if (!isRecord(reply)) return { kind: "error", at: now(), code: "desktop_bad_reply" };
    if (reply.ok === false) return { kind: "error", at: now(), code: teamStatusErrorCode(reply.error) };
    const data = reply.ok === true && isRecord(reply.data) ? reply.data : null;
    if (data && data.name === name && data.up === true && typeof data.text === "string") {
      return { kind: "read", at: now(), up: true, text: data.text };
    }
    if (data && data.name === name && data.up === false && data.text === null) {
      return { kind: "read", at: now(), up: false, text: null };
    }
    return { kind: "error", at: now(), code: "desktop_bad_reply" };
  } catch (error) {
    return { kind: "error", at: now(), code: teamStatusErrorCode(error) };
  }
}
