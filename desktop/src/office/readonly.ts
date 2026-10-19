import type { Locale } from "@/i18n/config";
import { describeError } from "../lib/error-catalog";
import type { TeamAgentsReading } from "../lib/existing-team-agents";
import type { ConnectionProbe } from "../lib/existing-team-readonly";
import type { TeamStatusReading } from "../lib/existing-team-status";
import { EXISTING_TEAM_AGENTS_TEXT } from "../pages/agents/readonly.i18n";
import { EXISTING_TEAM_STATUS_TEXT } from "../pages/existing-team/existing-team-status.i18n";
import type { AgentRole, AgentStatus, AgentStatuses, OfficeAgent, OfficeSnapshot, Piles } from "./contract";

/**
 * The office of an existing team that is only read over its VPS. It has no
 * cloud and no Realtime: what it knows is what the Squadra page of that view
 * knows, from the same two sources and nothing more:
 *
 *  - the read behind «Aggiorna» (readTeamStatus: is the container up, ...);
 *  - the connection's own probe of the captain and assistant sessions, with
 *    its time (ConnectionProbe).
 *
 *  - and, when it could be read, the list of the team's agents the Agents page
 *    shows (lib/existing-team-agents.ts, one read shared by both): then every
 *    agent session that is up and has a character in the office is drawn, by
 *    role and instance (scout-1, scout-2, critico-s3…), with the state the team
 *    computes for it when the VPS publishes one.
 *
 * Without that list, only the captain and the assistant can be in the office,
 * and only when their session is up. A session being up does not say what the agent is doing, so every
 * agent drawn has the status "unknown" (grey, «UNKNOWN»): never working,
 * never waiting. No position is moving, and an agent that is not known to be
 * there is not drawn, never invented. The piles are the counts of the team's
 * positions when they could be read (the same read as the panels and the
 * globe, vps-panels.ts), unknown (null) otherwise, never zero. The piles
 * are the counts of the team's positions when they were read (the same read
 * as the panels and the globe), unknown otherwise, never zero.
 */

/** The two sessions the VPS probe tells about, as office agents. */
const SESSIONS: ReadonlyArray<{ field: "captainRunning" | "assistantRunning"; agent: OfficeAgent }> = [
  { field: "captainRunning", agent: { uid: "capitano", role: "capitano", sheet: "" } },
  { field: "assistantRunning", agent: { uid: "assistente", role: "assistente", sheet: "" } },
];

/** The roles that have a character in the office (AgentRole): the others (closer, dottore…) are not drawn. */
const OFFICE_ROLES: readonly AgentRole[] = [
  "capitano",
  "scout",
  "analista",
  "scorer",
  "scrittore",
  "critico",
  "sentinella",
  "assistente",
  "mentor",
];

const UNKNOWN_PILES: Piles = { scout: null, analisti: null, scorer: null, scrittori: null, critici: null };

export type ProbeOffice = {
  snapshot: OfficeSnapshot;
  /** the agents' tags: null when there is no one to tag */
  statuses: AgentStatuses | null;
  /** the sentence under the scene, in the person's language; null when nothing needs saying */
  notice: { text: string; alert: boolean } | null;
};

function snapshotOf(online: boolean | null, roster: OfficeAgent[], piles: Piles | null = null): OfficeSnapshot {
  return { teamOnline: online, heartbeatAt: null, roster, piles: { ...(piles ?? UNKNOWN_PILES) }, transitions: [] };
}

function stamp(at: number, locale: Locale): string {
  return new Date(at).toLocaleString(locale, { dateStyle: "short", timeStyle: "medium" });
}

/**
 * The office from one read of the team's VPS and the connection's probe. A
 * read that failed, or never happened, leaves the office empty: an old
 * reading is not offered as the present, as the Squadra page does.
 */
export function officeFromTeamProbe(
  reading: TeamStatusReading,
  connection: ConnectionProbe | null,
  locale: Locale,
  /** the piles' counts from the team's positions, when they could be read; otherwise unknown */
  piles: Piles | null = null,
  /** the team's agents (the Agents page's read), when it was made; otherwise the connection's two sessions */
  teamAgents: TeamAgentsReading | null = null,
): ProbeOffice {
  const t = EXISTING_TEAM_STATUS_TEXT[locale];
  if (reading.kind === "unknown") {
    return { snapshot: snapshotOf(null, []), statuses: null, notice: { text: t.unknown, alert: false } };
  }
  if (reading.kind === "error") {
    const failure = describeError(reading.code, { fallback: "existing_team_unavailable", locale });
    return {
      snapshot: snapshotOf(null, []),
      statuses: null,
      notice: { text: `${t.failed}. ${failure.text} ${failure.action} (${reading.code})`, alert: true },
    };
  }
  if (!reading.fields.containerRunning) {
    return {
      snapshot: snapshotOf(false, []),
      statuses: null,
      notice: { text: t.fields.containerRunning.no, alert: false },
    };
  }
  if (teamAgents?.kind === "read") return officeFromAgents(teamAgents, locale, piles);
  if (!connection) {
    // The container is up but nobody can say which sessions: no one is drawn.
    return { snapshot: snapshotOf(true, [], piles), statuses: null, notice: { text: t.noConnectionValue, alert: false } };
  }
  const roster = SESSIONS.filter((s) => connection[s.field] === true).map((s) => s.agent);
  if (roster.length === 0) {
    return {
      snapshot: snapshotOf(true, [], piles),
      statuses: null,
      notice: { text: t.fields.captainRunning.no, alert: false },
    };
  }
  const agents: AgentStatuses["agents"] = {};
  for (const a of roster) agents[a.uid] = { status: "unknown" };
  return {
    snapshot: snapshotOf(true, roster, piles),
    statuses: { at: connection.at, agents },
    notice: {
      text: (connection.source === "assistant_start" ? t.atAssistantStart : t.atConnection).replace("{time}", stamp(connection.at, locale)),
      alert: false,
    },
  };
}

/**
 * The office from the team's list of agents: each session that is up and has
 * a character, by role and instance. Its state is the team's own computation
 * when the VPS publishes it; otherwise, and for a state the catalog does not
 * know, the agent is grey («UNKNOWN»), never working and never waiting.
 */
function officeFromAgents(agents: Extract<TeamAgentsReading, { kind: "read" }>, locale: Locale, piles: Piles | null): ProbeOffice {
  const t = EXISTING_TEAM_AGENTS_TEXT[locale];
  const drawn = agents.read.agents.filter((agent) => (OFFICE_ROLES as readonly string[]).includes(agent.role));
  const roster: OfficeAgent[] = drawn.map((agent) => ({ uid: agent.name.toLowerCase(), role: agent.role as AgentRole, sheet: "" }));
  const read = t.officeReadAt.replace("{time}", stamp(agents.at, locale));
  const unknown = agents.read.statesKnown ? "" : ` ${t.statesUnknown}`;
  if (roster.length === 0) {
    return { snapshot: snapshotOf(true, [], piles), statuses: null, notice: { text: `${t.officeNoneUp} ${read}${unknown}`, alert: false } };
  }
  const statuses: AgentStatuses["agents"] = {};
  for (const agent of drawn) {
    const status: AgentStatus = { status: "unknown" };
    if (agents.read.statesKnown && agent.state.state !== "sconosciuto") {
      status.state = agent.state.state;
      if (agent.state.reason) status.reason = agent.state.reason;
      if (agent.state.since !== undefined) status.since = agent.state.since;
      if (agent.state.until !== undefined) status.until = agent.state.until;
    }
    statuses[agent.name.toLowerCase()] = status;
  }
  return {
    snapshot: snapshotOf(true, roster, piles),
    statuses: { at: agents.at, agents: statuses },
    notice: { text: `${read}${unknown}`, alert: false },
  };
}
