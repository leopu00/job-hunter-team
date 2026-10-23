import { invoke } from "@tauri-apps/api/core";
import { pickAgentsRead, type TeamAgentsRead } from "./existing-team-agents";
import { teamStatusErrorCode } from "./existing-team-status";
import { pickOwnVpsState, type OwnVpsState } from "./own-vps-claim";

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
  /** where a VPS of the person's own stands (claim or key changed ask for their confirmation); null when it is not one */
  ownVps: OwnVpsState | null;
};

export type TeamControlState = {
  /** the user stopped the team (it does not restart by itself) */
  halted: boolean;
  standby: { state: "off" | "active" | "expired" | "invalid" | "unknown"; until: string | null; weeklyReset: boolean };
  /** the sessions held off: by the user from here, or by the team for safety; null when unknown */
  held: { session: string; byUser: boolean }[] | null;
  /** the user's full-throttle override: off, on until `expiresAt`, or ended; unknown for an image that does not say */
  burnIntent: { state: "off" | "active" | "expired" | "unknown" | null; expiresAt: string | null; remainingMin: number | null };
};

/** How a previous session of an agent ended, in the closed words the team's files allow; `unknown` is «not recorded». */
export type SessionEnd = "running" | "restarted_by_user" | "stopped_by_user" | "contained" | "retired" | "started_again" | "unknown";

export type PastSession = {
  /** epoch s */
  start: number;
  /** epoch s: when it ended, or at the latest; null while it runs and when nobody wrote it */
  end: number | null;
  reason: SessionEnd;
};

export type AgentHistory = {
  /** sessions that completed, newest first */
  sessions: PastSession[];
  /** starts that did not complete (epoch s), newest first */
  failed: number[];
};

export type PanelHistory = {
  /** agent session name → its history; an agent the team never traced is absent */
  agents: Record<string, AgentHistory>;
  /** epoch s: the trace is only known from here on (a long one was cut); null when it holds everything it had */
  since: number | null;
  /** moves of positions per role in each of the last 24 hours, the first being the last hour; null: the team's database could not be read */
  lanes: Record<string, number[]> | null;
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
  | "not_paused"
  | "team_stopped"
  | "team_already_stopped";
export type ExclusionResult = "excluded" | "exclusion_withdrawn";

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
    value: {
      ...agents,
      target: data.target,
      where,
      label: typeof data.label === "string" ? data.label : null,
      ownVps: pickOwnVpsState(data.ownVps),
    },
  };
}

const STANDBY_STATES = new Set(["off", "active", "expired", "invalid", "unknown"]);
const BURN_STATES = new Set(["off", "active", "expired", "unknown"]);

export async function readTeamState(): Promise<Outcome<TeamControlState>> {
  const read = await call({ op: "team" });
  if (!read.ok) return read;
  const data = read.value;
  const standby = isRecord(data.standby) ? data.standby : null;
  const burn = isRecord(data.burnIntent) ? data.burnIntent : null;
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
      burnIntent: {
        state: BURN_STATES.has(String(burn?.state)) ? (burn!.state as NonNullable<TeamControlState["burnIntent"]["state"]>) : null,
        expiresAt: typeof burn?.expiresAt === "string" ? burn.expiresAt : null,
        remainingMin:
          typeof burn?.remainingMin === "number" && Number.isInteger(burn.remainingMin) && burn.remainingMin >= 0 ? burn.remainingMin : null,
      },
    },
  };
}

const SESSION_ENDS = new Set<string>(["running", "restarted_by_user", "stopped_by_user", "contained", "retired", "started_again", "unknown"]);
export const LANE_HOURS = 24;

const seconds = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 4_102_444_800 ? value : null;

/** The history the native side shaped, checked once more: anything off the closed shape is left out, not repaired. */
export function pickHistory(data: Record<string, unknown>): PanelHistory | null {
  if (!Array.isArray(data.items)) return null;
  const agents: Record<string, AgentHistory> = {};
  for (const item of data.items) {
    if (!isRecord(item) || typeof item.name !== "string" || !Array.isArray(item.sessions)) continue;
    const sessions: PastSession[] = [];
    for (const raw of item.sessions) {
      if (!isRecord(raw)) continue;
      const start = seconds(raw.start);
      if (start === null) continue;
      const end = seconds(raw.end);
      sessions.push({
        start,
        end: end !== null && end >= start ? end : null,
        reason: typeof raw.reason === "string" && SESSION_ENDS.has(raw.reason) ? (raw.reason as SessionEnd) : "unknown",
      });
    }
    const failed = Array.isArray(item.failed) ? item.failed.map(seconds).filter((at): at is number => at !== null) : [];
    agents[item.name] = { sessions, failed };
  }
  let lanes: PanelHistory["lanes"] = null;
  if (isRecord(data.lanes)) {
    lanes = {};
    for (const [role, hours] of Object.entries(data.lanes)) {
      if (Array.isArray(hours) && hours.length === LANE_HOURS && hours.every((n) => typeof n === "number" && Number.isInteger(n) && n >= 0)) {
        lanes[role] = hours as number[];
      }
    }
  }
  return { agents, since: seconds(data.since), lanes };
}

export async function readPanelHistory(): Promise<Outcome<PanelHistory>> {
  const read = await call({ op: "history" });
  if (!read.ok) return read;
  const history = pickHistory(read.value);
  return history ? { ok: true, at: read.at, value: history } : { ok: false, at: read.at, code: "desktop_bad_reply" };
}

/** The terminal of an agent, and how soon to read it again (`refreshMs`, the native side's pace; absent from an older one). */
export async function readPanelScreen(
  session: string,
): Promise<Outcome<{ up: boolean; text: string | null; refreshMs: unknown }>> {
  const read = await call({ op: "screen", session });
  if (!read.ok) return read;
  const data = read.value;
  if (data.name !== session || typeof data.up !== "boolean") return { ok: false, at: read.at, code: "desktop_bad_reply" };
  if (data.up && typeof data.text === "string") {
    return { ok: true, at: read.at, value: { up: true, text: data.text, refreshMs: data.refreshMs } };
  }
  if (!data.up && data.text === null) return { ok: true, at: read.at, value: { up: false, text: null, refreshMs: data.refreshMs } };
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
  "team_stopped",
  "team_already_stopped",
]);

const EXCLUSION_RESULTS = new Set<string>(["excluded", "exclusion_withdrawn"]);

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
 * «Ferma la squadra»: `jht team stop` on the team the panel controls (this
 * computer, or the VPS it is linked to), through the same native command as
 * the pause. Never the cloud's request: only a team linked to the cloud reads it.
 */
export function stopTeam(target: string): Promise<Outcome<ActionResult>> {
  return act({ op: "stop_team", target });
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

// ── the exclusions of the profile (JHT-T24-b) ───────────────────────────────
/** The kinds of position whose exclusion acts on the score (shared/feedback-reasons.json, `acting`). */
export type ExclusionCode = "company" | "wrong_location" | "salary_low" | "wrong_stack" | "too_senior" | "too_junior";

export type PanelExclusions = {
  /** opaque: the team this was read from; a decision sends it back */
  target: string;
  where: PanelWhere;
  label: string | null;
  ownVps: OwnVpsState | null;
  exclusions: { code: string; status: "active" | "withdrawn"; decidedAt: string | null }[];
  /** the user's judgements on positions, newest first: what the proposals are made of */
  feedback: { id: number; legacyId: number; action: string; reason: string | null; createdAt: string | null }[];
};

export async function readExclusions(): Promise<Outcome<PanelExclusions>> {
  const read = await call({ op: "exclusions" });
  if (!read.ok) return read;
  const data = read.value;
  const where = data.where === "vps" || data.where === "local" ? data.where : null;
  if (typeof data.target !== "string" || !where || !Array.isArray(data.exclusions) || !Array.isArray(data.feedback)) {
    return { ok: false, at: read.at, code: "desktop_bad_reply" };
  }
  return {
    ok: true,
    at: read.at,
    value: {
      target: data.target,
      where,
      label: typeof data.label === "string" ? data.label : null,
      ownVps: pickOwnVpsState(data.ownVps),
      exclusions: data.exclusions.filter(
        (row): row is PanelExclusions["exclusions"][number] =>
          isRecord(row) && typeof row.code === "string" && (row.status === "active" || row.status === "withdrawn"),
      ),
      feedback: data.feedback.filter(
        (row): row is PanelExclusions["feedback"][number] =>
          isRecord(row) && typeof row.id === "number" && typeof row.legacyId === "number" && typeof row.action === "string",
      ),
    },
  };
}

async function decide(request: Record<string, unknown>): Promise<Outcome<ExclusionResult>> {
  const done = await call({ ...request, confirmed: true });
  if (!done.ok) return done;
  const result = done.value.result;
  return typeof result === "string" && EXCLUSION_RESULTS.has(result)
    ? { ok: true, at: done.at, value: result as ExclusionResult }
    : { ok: false, at: done.at, code: "agent_control_unanswered" };
}

/** Only after the person decided it in the page. The native side asks for the full link or the mark of the VPS. */
export function acceptExclusion(code: ExclusionCode, target: string): Promise<Outcome<ExclusionResult>> {
  return decide({ op: "exclusion_accept", code, target });
}

export function withdrawExclusion(code: ExclusionCode, target: string): Promise<Outcome<ExclusionResult>> {
  return decide({ op: "exclusion_withdraw", code, target });
}

// ── the answer to an agent's question (JHT-T38) ─────────────────────────────
export type AnswerResult = "answered" | "already_answered" | "expired";
const ANSWER_RESULTS = new Set<string>(["answered", "already_answered", "expired"]);
const QUESTION_ID = /^aq:[a-z0-9][a-z0-9_-]{0,39}:[0-9]{1,20}-[a-z0-9]{1,16}$/;
const OPTION_ID = /^(?:_rinvia|[a-z0-9][a-z0-9_]{0,23})$/;

/**
 * One option of an agent's structured question, by the ids the question carries: never text.
 * Only after the person chose it in the page (with a confirmation when the option does not
 * say it can be undone). The native side asks for the full link or the mark of the VPS, and
 * the team's agent_questions decides whether the option is the question's: the first answer wins.
 */
export async function answerQuestion(question: string, choice: string, target: string): Promise<Outcome<AnswerResult>> {
  if (!QUESTION_ID.test(question) || !OPTION_ID.test(choice)) return { ok: false, at: Date.now(), code: "agent_control_invalid" };
  const done = await call({ op: "answer", question, choice, target, confirmed: true });
  if (!done.ok) return done;
  const result = done.value.result;
  return typeof result === "string" && ANSWER_RESULTS.has(result)
    ? { ok: true, at: done.at, value: result as AnswerResult }
    : { ok: false, at: done.at, code: "agent_control_unanswered" };
}
