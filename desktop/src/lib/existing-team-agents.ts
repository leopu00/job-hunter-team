import { invoke } from "@tauri-apps/api/core";
import { isAgentState, isKnownReason, type AgentStateInfo } from "@/lib/agent-state";
import { existingTeamView, type ExistingTeamReadOnly } from "./existing-team-readonly";
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
  /** which CLI, model and effort the agent was started with, null when the session does not say (only to be shown) */
  identity: AgentIdentity | null;
  /** what agent_state.py says, or "sconosciuto" when the VPS does not say it */
  state: AgentStateInfo;
  /** how full its context is and its tokens of the last hour: each null when the team does not say it, never 0 */
  usage: AgentUsage;
  /** the questions it asked the user and its unread messages; null when the team does not say them, never 0 */
  questions: AgentQuestions | null;
};

export type QuestionType = "urgente" | "blocco" | "domanda" | "completamento" | "comunicazione";

export type QuestionOption = { id: string; label: string; reversible: boolean };

/**
 * One open question an agent asked the user. A structured one (agent_questions.py)
 * has an id, a type and its options; one written before the contract has neither
 * (it is answered in words, from the messages). Every text is the agent's, as it
 * wrote it: shown as plain text, never translated, never HTML.
 */
export type AgentQuestion = {
  id: string | null;
  type: QuestionType | null;
  subject: string | null;
  text: string;
  options: QuestionOption[];
  multiple: boolean;
  free: boolean;
  /** epoch ms; null without an expiry */
  expiresAt: number | null;
  /** the option taken when it expires */
  fallback: string | null;
  /** when it was asked, epoch ms */
  at: number;
};

/** Only to be shown: nothing decides on it. */
export type AgentQuestions = { open: number; unread: number; items: AgentQuestion[] };

export type AgentUsage = {
  /** 0-100, from the CLI's own window or share; null for a CLI that writes neither (Claude) */
  contextPct: number | null;
  /** the tokens of its last model call */
  contextTokens: number | null;
  contextWindow: number | null;
  /** when the context was read, epoch ms */
  contextAt: number | null;
  /** the tokens of the last hour, as the team's sentinel counts them */
  tokensHour: number | null;
  /** when they were counted, epoch ms */
  tokensAt: number | null;
};

/**
 * Who an agent is, as start-agent.sh wrote it on the agent's own tmux session
 * and the native side filtered it (existing_team_agents.rs, shape_identity).
 * Only to be shown: the agent can rewrite its session's options, so nothing
 * decides on it. A part the session does not say is null («non so»).
 */
export type AgentIdentity = {
  cli: "claude" | "codex" | "kimi" | "pi" | "local";
  model: string | null;
  effort: "low" | "medium" | "high" | null;
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

const IDENTITY_CLI = new Set(["claude", "codex", "kimi", "pi", "local"]);
const IDENTITY_EFFORT = new Set(["low", "medium", "high"]);
const IDENTITY_MODEL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,39}$/;

/** The same closed shape the native side lets through, checked once more. */
export function pickIdentity(value: unknown): AgentIdentity | null {
  if (!isRecord(value) || typeof value.cli !== "string" || !IDENTITY_CLI.has(value.cli)) return null;
  return {
    cli: value.cli as AgentIdentity["cli"],
    model: typeof value.model === "string" && IDENTITY_MODEL.test(value.model) ? value.model : null,
    effort: typeof value.effort === "string" && IDENTITY_EFFORT.has(value.effort) ? (value.effort as AgentIdentity["effort"]) : null,
  };
}

export const QUESTION_TYPES: readonly QuestionType[] = ["urgente", "blocco", "domanda", "completamento", "comunicazione"];
const QUESTION_ID = /^aq:[a-z0-9][a-z0-9_-]{0,39}:[0-9]{1,20}-[a-z0-9]{1,16}$/;
const OPTION_ID = /^(_rinvia|[a-z0-9][a-z0-9_]{0,23})$/;
// one line, no control character nor invisible command (external_content.py, INVISIBLE_COMMANDS)
const NOT_ONE_LINE = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b\u2028\u2029\u202a-\u202e\u2060\u2066-\u2069\ufeff\ufff9-\ufffb]|\udb40[\udc00-\udc7f]/;
/** At most this many per agent and in the whole list, as agent_state.py and the native side cut them. */
export const QUESTIONS_PER_AGENT = 5;
export const QUESTIONS_PER_LIST = 20;

function oneLine(value: unknown, max: number): string | null {
  if (typeof value !== "string" || !value.trim() || [...value].length > max || NOT_ONE_LINE.test(value)) return null;
  return value;
}

function pickQuestion(value: unknown): AgentQuestion | null {
  if (!isRecord(value)) return null;
  const structured = value.id !== null;
  if (structured && (typeof value.id !== "string" || !QUESTION_ID.test(value.id))) return null;
  const type = value.tipo === null ? null : QUESTION_TYPES.find((tipo) => tipo === value.tipo);
  if (type === undefined || structured !== (type !== null) || !Array.isArray(value.opzioni)) return null;
  const options: QuestionOption[] = [];
  for (const option of value.opzioni) {
    if (!isRecord(option) || typeof option.id !== "string" || !OPTION_ID.test(option.id)) return null;
    if (options.some((seen) => seen.id === option.id)) return null;
    const label = oneLine(option.label, 60);
    if (label === null) return null;
    // reversible only with the boolean true: anything else asks for a confirmation
    options.push({ id: option.id, label, reversible: option.reversibile === true });
  }
  if (structured ? options.length < 2 || options.length > 8 : options.length > 0) return null;
  const subject = structured ? oneLine(value.oggetto, 120) : null;
  const text = oneLine(value.testo, 280);
  const at = epoch(value.at);
  if ((structured && subject === null) || text === null || at === null) return null;
  const fallback = value.default === null || value.default === undefined ? null : value.default;
  if (fallback !== null && !options.some((option) => option.id === fallback)) return null;
  const expires = epoch(value.scadenza);
  return {
    id: structured ? (value.id as string) : null,
    type,
    subject,
    text,
    options,
    multiple: structured && value.multipla === true,
    free: !structured || value.libera === true,
    expiresAt: expires === null ? null : expires * 1000,
    fallback: fallback as string | null,
    at: at * 1000,
  };
}

/** The same closed shape the native side lets through (shape_questions), checked once more. */
export function pickQuestions(value: unknown): AgentQuestions | null {
  if (!isRecord(value) || !Array.isArray(value.items)) return null;
  const whole = (n: unknown) => (typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 9999 ? n : null);
  const open = whole(value.open);
  const unread = whole(value.unread);
  if (open === null || unread === null) return null;
  const items = value.items
    .slice(0, QUESTIONS_PER_AGENT)
    .map(pickQuestion)
    .filter((item): item is AgentQuestion => item !== null);
  return { open, unread, items };
}

const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null);

export function pickUsage(value: unknown): AgentUsage {
  const usage = isRecord(value) ? value : {};
  const pct = count(usage.contextPct);
  const at = (key: string) => {
    const seconds = epoch(usage[key]);
    return seconds === null ? null : seconds * 1000;
  };
  return {
    contextPct: pct !== null && pct <= 100 ? pct : null,
    contextTokens: count(usage.contextTokens),
    contextWindow: count(usage.contextWindow),
    contextAt: at("contextAt"),
    tokensHour: count(usage.tokensHour),
    tokensAt: at("tokensAt"),
  };
}

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
    identity: pickIdentity(value.identity),
    state,
    usage: pickUsage(value.usage),
    questions: pickQuestions(value.questions),
  };
}

export function pickAgentsRead(data: unknown): TeamAgentsRead | null {
  if (!isRecord(data) || !Array.isArray(data.agents) || !Array.isArray(data.roles) || typeof data.states !== "boolean") {
    return null;
  }
  const statesKnown = data.states;
  const agents = data.agents.map((agent) => pickAgent(agent, statesKnown));
  if (agents.some((agent) => agent === null)) return null;
  let left = QUESTIONS_PER_LIST;
  for (const agent of agents as TeamAgent[]) {
    if (!agent.questions) continue;
    agent.questions.items = agent.questions.items.slice(0, left);
    left -= agent.questions.items.length;
  }
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

/** The page and the office opened one after the other: one read of the VPS serves both. */
export const SHARED_AGENTS_MS = 5_000;

let shared: { at: number; view: ExistingTeamReadOnly | null; read: Promise<TeamAgentsReading> } | null = null;

/**
 * The team's agents, one read shared by everything in the read-only view that
 * shows them (the Agents page and the office) for SHARED_AGENTS_MS. It belongs
 * to the opening of the view it was made in: after the view is left, or opened
 * again (another VPS, another team), a new read is made, never the old one. A
 * read that comes back after the view changed is not given to the new one: it
 * is told the target changed, as the shared positions read does.
 */
export function readTeamAgentsShared(now = Date.now()): Promise<TeamAgentsReading> {
  const view = existingTeamView();
  if (shared && shared.view === view && now - shared.at < SHARED_AGENTS_MS) return shared.read;
  const read = readTeamAgents().then((result): TeamAgentsReading =>
    existingTeamView() === view ? result : { kind: "error", at: Date.now(), code: "existing_team_target_changed" });
  shared = { at: now, view, read };
  return read;
}

/** Forgets the shared read (a test). */
export function resetTeamAgentsShared(): void {
  shared = null;
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
