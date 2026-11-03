import { describe, expect, it } from "vitest";
import { pickHistory, type PanelHistory, type PastSession } from "../../lib/agent-control";
import { buildGantt, durationText, roleOfSession, sessionSeconds } from "./history";

// The history of the agents' sessions (JHT-T43): synthetic data only.
const NOW = 1_790_000_000;
const UNITS = { day: "d", hour: "h", min: "min" };
const hours = (...firsts: number[]) => [...firsts, ...Array(24 - firsts.length).fill(0)];

describe("durationText", () => {
  it("says the two largest units, short", () => {
    expect(durationText(20, UNITS)).toBe("<1 min");
    expect(durationText(12 * 60, UNITS)).toBe("12 min");
    expect(durationText(3 * 3600, UNITS)).toBe("3 h");
    expect(durationText(3 * 3600 + 20 * 60 + 59, UNITS)).toBe("3 h 20 min");
    expect(durationText(2 * 86400, UNITS)).toBe("2 d");
    expect(durationText(2 * 86400 + 3 * 3600 + 5 * 60, UNITS)).toBe("2 d 3 h");
  });
});

describe("sessionSeconds", () => {
  it("is the length of an ended one, the time so far of a running one, and nothing for an end nobody wrote", () => {
    expect(sessionSeconds({ start: 100, end: 400, reason: "stopped_by_user" }, NOW)).toBe(300);
    expect(sessionSeconds({ start: NOW - 90, end: null, reason: "running" }, NOW)).toBe(90);
    expect(sessionSeconds({ start: 100, end: null, reason: "unknown" }, NOW)).toBeNull();
  });
});

describe("roleOfSession", () => {
  it("is the role of the launcher's names", () => {
    expect(["SCOUT-2", "CAPITANO", "CRITICO-S3", "ANALISTA-1"].map(roleOfSession)).toEqual(["scout", "capitano", "critico", "analista"]);
  });
});

describe("pickHistory", () => {
  const data = (over: Record<string, unknown> = {}) => ({
    since: null,
    lanes: { scout: hours(1) },
    items: [{ name: "SCOUT-1", failed: [5, "x", -1], sessions: [{ start: 10, end: 20, reason: "retired" }] }],
    ...over,
  });

  it("keeps what has the closed shape", () => {
    expect(pickHistory(data())).toEqual({
      agents: { "SCOUT-1": { sessions: [{ start: 10, end: 20, reason: "retired" }], failed: [5] } },
      since: null,
      lanes: { scout: hours(1) },
    });
  });

  it("turns a word it does not know into «unknown», an end before the start into no end, and drops what is not a moment", () => {
    const picked = pickHistory(
      data({
        items: [
          {
            name: "SCOUT-1",
            failed: [],
            sessions: [
              { start: 10, end: 5, reason: "retired" },
              { start: 11, end: 20, reason: "made up; rm -rf /" },
              { start: "11", end: 20, reason: "retired" },
              { start: 1.5, end: 20, reason: "retired" },
            ],
          },
        ],
      }),
    )!;
    expect(picked.agents["SCOUT-1"].sessions).toEqual([
      { start: 10, end: null, reason: "retired" },
      { start: 11, end: 20, reason: "unknown" },
    ]);
  });

  it("keeps «lanes not known» as null and refuses a lane that is not 24 counts", () => {
    expect(pickHistory(data({ lanes: null }))!.lanes).toBeNull();
    expect(pickHistory(data({ lanes: { scout: [1, 2, 3], mentor: hours(-1), scorer: hours(2) } }))!.lanes).toEqual({ scorer: hours(2) });
  });

  it("is nothing for a reply without the items", () => {
    expect(pickHistory({ result: "stopped" })).toBeNull();
  });
});

describe("buildGantt", () => {
  const session = (start: number, end: number | null, reason: PastSession["reason"]): PastSession => ({ start, end, reason });
  const history = (agents: PanelHistory["agents"]): PanelHistory => ({ agents, since: null, lanes: null });

  it("makes one row per agent that was up in the last day, one bar per session, cut to the window", () => {
    const rows = buildGantt(
      history({
        "SCOUT-1": { failed: [], sessions: [session(NOW - 1800, null, "running"), session(NOW - 30 * 3600, NOW - 20 * 3600, "restarted_by_user")] },
        "MENTOR-1": { failed: [], sessions: [session(NOW - 95000, NOW - 87000, "stopped_by_user")] },
      }),
      ["scout", "mentor"],
      NOW,
    );
    expect(rows.map((row) => row.agent)).toEqual(["SCOUT-1"]); // MENTOR-1 ended more than a day ago
    expect(rows[0].role).toBe("scout");
    expect(rows[0].bars).toHaveLength(2);
    // the older one started before the window: it is cut to its start
    expect(rows[0].bars[0]).toMatchObject({ start: NOW - 24 * 3600, end: NOW - 20 * 3600, open: false, endKnown: true });
    expect(rows[0].bars[1]).toMatchObject({ start: NOW - 1800, end: NOW, open: true, endKnown: true });
  });

  it("covers no more than the team said of a session whose end nobody wrote: a mark at its start", () => {
    const [row] = buildGantt(history({ "SCOUT-1": { failed: [], sessions: [session(NOW - 5 * 3600, null, "unknown")] } }), ["scout"], NOW);
    expect(row.bars).toEqual([{ start: NOW - 5 * 3600, end: NOW - 5 * 3600, open: false, endKnown: false, reason: "unknown" }]);
  });

  it("orders the rows by the team's departments, then by name with the numbers as numbers", () => {
    const up = { failed: [], sessions: [session(NOW - 3600, null, "running")] };
    const rows = buildGantt(history({ "SCOUT-10": up, "SCOUT-2": up, "CAPITANO": up, "ZZ-1": up }), ["capitano", "scout"], NOW);
    expect(rows.map((row) => row.agent)).toEqual(["CAPITANO", "SCOUT-2", "SCOUT-10", "ZZ-1"]);
  });

  it("is empty when no agent was up in the day: nothing to draw, not an error", () => {
    expect(buildGantt(history({}), ["scout"], NOW)).toEqual([]);
  });
});
