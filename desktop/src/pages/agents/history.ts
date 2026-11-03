import { LANE_HOURS, type PanelHistory, type PastSession } from "../../lib/agent-control";

/**
 * What the Agents page makes of the history read (JHT-T43): how long a session lasted, and the lanes of the last
 * day. Pure functions of the data the team sent: nothing here reads a clock or the team.
 */

const HOUR = 3600;

/** The role of an agent's session: SCOUT-2 → scout, CRITICO-S3 → critico. */
export function roleOfSession(session: string): string {
  return session.split("-")[0].toLowerCase();
}

/** How long a session lasted, in seconds; null when it ended and nobody wrote when. A running one lasts until `nowS`. */
export function sessionSeconds(session: PastSession, nowS: number): number | null {
  if (session.end !== null) return Math.max(0, session.end - session.start);
  return session.reason === "running" ? Math.max(0, nowS - session.start) : null;
}

export type DurationUnits = { day: string; hour: string; min: string };

/** «2 d 3 h», «3 h 20 min», «12 min», «<1 min»: the two largest units, short, in the language's own unit marks. */
export function durationText(seconds: number, units: DurationUnits): string {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return `<1 ${units.min}`;
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  if (days > 0) return hours > 0 ? `${days} ${units.day} ${hours} ${units.hour}` : `${days} ${units.day}`;
  if (hours > 0) return rest > 0 ? `${hours} ${units.hour} ${rest} ${units.min}` : `${hours} ${units.hour}`;
  return `${rest} ${units.min}`;
}

/** The window of the gantt: the last LANE_HOURS hours, ending at `nowS`. */
export const GANTT_SECONDS = LANE_HOURS * HOUR;

export type GanttBar = {
  /** epoch s, cut to the window */
  start: number;
  end: number;
  /** the session is still running: its bar reaches «now» */
  open: boolean;
  /** false: it ended and nobody wrote when, so it is a mark at its start and never a stretch the team did not say */
  endKnown: boolean;
  reason: PastSession["reason"];
};

export type GanttRow = { agent: string; role: string; bars: GanttBar[] };

/**
 * One row per agent that was up in the last day, one bar per session, as the team traced them. A session that ended at an
 * unknown moment only covers the moment it started, never more than the team said. Rows go by the order of `roles` (the
 * team's departments), then by name.
 */
export function buildGantt(history: PanelHistory, roles: string[], nowS: number): GanttRow[] {
  const from = nowS - GANTT_SECONDS;
  const rows: GanttRow[] = [];
  for (const [agent, past] of Object.entries(history.agents)) {
    const bars: GanttBar[] = [];
    for (const s of past.sessions) {
      const running = s.end === null && s.reason === "running";
      const known = s.end !== null ? s.end : running ? nowS : null;
      const end = known ?? s.start;
      if (end < from || s.start > nowS) continue;
      bars.push({ start: Math.max(s.start, from), end: Math.min(end, nowS), open: running, endKnown: known !== null, reason: s.reason });
    }
    if (bars.length > 0) rows.push({ agent, role: roleOfSession(agent), bars: bars.sort((x, y) => x.start - y.start) });
  }
  const rank = (role: string) => {
    const at = roles.indexOf(role);
    return at === -1 ? roles.length : at;
  };
  return rows.sort((x, y) => rank(x.role) - rank(y.role) || x.agent.localeCompare(y.agent, "en", { numeric: true }));
}
