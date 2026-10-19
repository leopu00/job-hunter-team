import { invoke } from "@tauri-apps/api/core";
import { pickAgentsRead, type TeamAgentsRead } from "./existing-team-agents";
import { teamStatusErrorCode } from "./existing-team-status";

/**
 * The agents' control panel (native command agent_control, agent_control.rs):
 * read the team's agents, start, stop or restart one, pause or resume the
 * team. The page sends an operation, a session name from the list, and back
 * the opaque `target` the list gave it: never a host, a container or a
 * command. The native side decides where the team is, refuses every action
 * on a team linked read only, and refuses an action prepared on another
 * team (existing_team_runtime_target_changed).
 */
const COMMAND = "agent_control";

export type PanelWhere = "local" | "vps";

export type PanelList = TeamAgentsRead & {
  /** opaque: the team this list was read from; every action sends it back */
  target: string;
  where: PanelWhere;
  /** the VPS's address, for the confirmation; null on this computer */
  label: string | null;
};

export type TeamControlState = {
  /** the user stopped the team (it does not restart by itself) */
  halted: boolean;
  standby: { state: "off" | "active" | "expired" | "invalid" | "unknown"; until: string | null; weeklyReset: boolean };
  /** the sessions held off: by the user from here, or by the team for safety; null when unknown */
  held: { session: string; byUser: boolean }[] | null;
};

export type AgentAction = "start" | "stop" | "restart";
export type PauseExit = { kind: "hours"; hours: number } | { kind: "until"; until: string } | { kind: "weekly_reset" };
export type ActionResult =
  | "started"
  | "already_running"
  | "stopped"
  | "already_stopped"
  | "restarted"
  | "paused"
  | "already_paused"
  | "resumed"
  | "not_paused";

export type Outcome<T> = { ok: true; at: number; value: T } | { ok: false; at: number; code: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function call(request: Record<string, unknown>): Promise<Outcome<Record<string, unknown>>> {
  try {
    const reply = await invoke<unknown>(COMMAND, { request });
    if (!isRecord(reply)) return { ok: false, at: Date.now(), code: "desktop_bad_reply" };
    if (reply.ok === false) return { ok: false, at: Date.now(), code: teamStatusErrorCode(reply.error) };
    if (reply.ok === true && isRecord(reply.data)) return { ok: true, at: Date.now(), value: reply.data };
    return { ok: false, at: Date.now(), code: "desktop_bad_reply" };
  } catch (error) {
    return { ok: false, at: Date.now(), code: teamStatusErrorCode(error) };
  }
}

export async function readPanelList(): Promise<Outcome<PanelList>> {
  const read = await call({ op: "list" });
  if (!read.ok) return read;
  const data = read.value;
  const agents = pickAgentsRead(data);
  const where = data.where === "vps" || data.where === "local" ? data.where : null;
  if (!agents || typeof data.target !== "string" || !where) return { ok: false, at: read.at, code: "desktop_bad_reply" };
  return {
    ok: true,
    at: read.at,
    value: { ...agents, target: data.target, where, label: typeof data.label === "string" ? data.label : null },
  };
}

const STANDBY_STATES = new Set(["off", "active", "expired", "invalid", "unknown"]);

export async function readTeamState(): Promise<Outcome<TeamControlState>> {
  const read = await call({ op: "team" });
  if (!read.ok) return read;
  const data = read.value;
  const standby = isRecord(data.standby) ? data.standby : null;
  if (typeof data.halted !== "boolean" || !standby || !STANDBY_STATES.has(String(standby.state))) {
    return { ok: false, at: read.at, code: "desktop_bad_reply" };
  }
  const held = Array.isArray(data.held)
    ? data.held.filter(
        (item): item is { session: string; byUser: boolean } =>
          isRecord(item) && typeof item.session === "string" && typeof item.byUser === "boolean",
      )
    : null;
  return {
    ok: true,
    at: read.at,
    value: {
      halted: data.halted,
      standby: {
        state: standby.state as TeamControlState["standby"]["state"],
        until: typeof standby.until === "string" ? standby.until : null,
        weeklyReset: standby.weeklyReset === true,
      },
      held,
    },
  };
}

export async function readPanelScreen(session: string): Promise<Outcome<{ up: boolean; text: string | null }>> {
  const read = await call({ op: "screen", session });
  if (!read.ok) return read;
  const data = read.value;
  if (data.name !== session || typeof data.up !== "boolean") return { ok: false, at: read.at, code: "desktop_bad_reply" };
  if (data.up && typeof data.text === "string") return { ok: true, at: read.at, value: { up: true, text: data.text } };
  if (!data.up && data.text === null) return { ok: true, at: read.at, value: { up: false, text: null } };
  return { ok: false, at: read.at, code: "desktop_bad_reply" };
}

const RESULTS = new Set<string>([
  "started",
  "already_running",
  "stopped",
  "already_stopped",
  "restarted",
  "paused",
  "already_paused",
  "resumed",
  "not_paused",
]);

async function act(request: Record<string, unknown>): Promise<Outcome<ActionResult>> {
  const done = await call({ ...request, confirmed: true });
  if (!done.ok) return done;
  const result = done.value.result;
  return typeof result === "string" && RESULTS.has(result)
    ? { ok: true, at: done.at, value: result as ActionResult }
    : { ok: false, at: done.at, code: "agent_control_unanswered" };
}

/** Only after the person confirmed it in the page's dialog. */
export function controlAgent(op: AgentAction, session: string, target: string): Promise<Outcome<ActionResult>> {
  return act({ op, session, target });
}

export function pauseTeam(exit: PauseExit, target: string): Promise<Outcome<ActionResult>> {
  return act({ op: "pause", exit, target });
}

export function resumeTeam(target: string): Promise<Outcome<ActionResult>> {
  return act({ op: "resume", target });
}

/**
 * «Until tomorrow at 8»: 08:00 of the next day in the person's own time zone,
 * sent as an instant in UTC (YYYY-MM-DDTHH:MM:SSZ), the only form the native
 * side accepts.
 */
export function tomorrowAtEightUtc(now: Date = new Date()): string {
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 8, 0, 0, 0);
  return `${at.toISOString().slice(0, 19)}Z`;
}
