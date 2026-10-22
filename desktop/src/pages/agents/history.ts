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

export type LaneCell = {
  /** moves of positions in this hour */
  moves: number;
  /** an agent of the department was up at some moment of this hour (the sessions the team traced) */
  up: boolean;
  /** the hour, epoch s: [from, to) */
  from: number;
  to: number;
};

export type Lane = { role: string; cells: LaneCell[]; total: number };

/**
 * One lane per role of the team, oldest hour first, ending at `nowS`. The counts are the team's (the first count
 * of a role is its last hour); «up» comes from the sessions: one that ended at an unknown moment only covers the
 * moment it started, never more than the team said. Null when the moves could not be read: not known is not zero.
 */
export function buildLanes(history: PanelHistory, roles: string[], nowS: number): Lane[] | null {
  if (history.lanes === null) return null;
  const sessionsByRole = new Map<string, PastSession[]>();
  for (const [name, agent] of Object.entries(history.agents)) {
    const role = roleOfSession(name);
    sessionsByRole.set(role, [...(sessionsByRole.get(role) ?? []), ...agent.sessions]);
  }
  return roles.map((role) => {
    const counts = history.lanes?.[role];
    const sessions = sessionsByRole.get(role) ?? [];
    const cells: LaneCell[] = [];
    for (let index = 0; index < LANE_HOURS; index++) {
      const ago = LANE_HOURS - 1 - index; // 0 is the last hour
      const to = nowS - ago * HOUR;
      const from = to - HOUR;
      const reaches = (s: PastSession) => {
        const end = s.end ?? (s.reason === "running" ? nowS : s.start);
        return s.start < to && end >= from;
      };
      cells.push({ moves: counts?.[ago] ?? 0, up: sessions.some(reaches), from, to });
    }
    return { role, cells, total: cells.reduce((sum, cell) => sum + cell.moves, 0) };
  });
}
