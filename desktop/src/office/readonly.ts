import type { Locale } from "@/i18n/config";
import { describeError } from "../lib/error-catalog";
import type { ConnectionProbe } from "../lib/existing-team-readonly";
import type { TeamStatusReading } from "../lib/existing-team-status";
import { EXISTING_TEAM_STATUS_TEXT } from "../pages/existing-team/existing-team-status.i18n";
import type { AgentStatuses, OfficeAgent, OfficeSnapshot, Piles } from "./contract";

/**
 * The office of an existing team that is only read over its VPS. It has no
 * cloud and no Realtime: what it knows is what the Squadra page of that view
 * knows, from the same two sources and nothing more:
 *
 *  - the read behind «Aggiorna» (readTeamStatus: is the container up, ...);
 *  - the connection's own probe of the captain and assistant sessions, with
 *    its time (ConnectionProbe).
 *
 * So only those two agents can be in the office, and only when their session
 * is up. A session being up does not say what the agent is doing, so every
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
