import { describe, expect, it } from "vitest";
import { pickHistory, type PanelHistory, type PastSession } from "../../lib/agent-control";
import { buildLanes, durationText, roleOfSession, sessionSeconds } from "./history";

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

describe("buildLanes", () => {
  const session = (start: number, end: number | null, reason: PastSession["reason"]): PastSession => ({ start, end, reason });
  const history = (lanes: PanelHistory["lanes"], agents: PanelHistory["agents"] = {}): PanelHistory => ({ agents, since: null, lanes });

  it("is null when the moves could not be read: not known is not zero", () => {
    expect(buildLanes(history(null), ["scout"], NOW)).toBeNull();
  });

  it("puts the last hour in the last box and the hour before in the box before", () => {
    const [lane] = buildLanes(history({ scout: hours(2, 0, 5) }), ["scout"], NOW)!;
    expect(lane.cells).toHaveLength(24);
    expect(lane.cells[23].moves).toBe(2);
    expect(lane.cells[21].moves).toBe(5);
    expect(lane.total).toBe(7);
    expect(lane.cells[23].to).toBe(NOW);
    expect(lane.cells[23].from).toBe(NOW - 3600);
    expect(lane.cells[0].from).toBe(NOW - 24 * 3600);
  });

  it("gives a role the team did not count an empty lane, not a missing one", () => {
    const lanes = buildLanes(history({ scout: hours(1) }), ["scout", "mentor"], NOW)!;
    expect(lanes.map((lane) => lane.role)).toEqual(["scout", "mentor"]);
    expect(lanes[1].total).toBe(0);
  });

  it("marks the hours an agent of the role was up, from every instance's sessions", () => {
    const agents = {
      "SCOUT-1": { failed: [], sessions: [session(NOW - 3 * 3600 - 600, NOW - 2 * 3600 - 600, "restarted_by_user")] },
      "SCOUT-2": { failed: [], sessions: [session(NOW - 1800, null, "running")] },
      "ANALISTA-1": { failed: [], sessions: [session(NOW - 20 * 3600, null, "running")] },
    };
    const [scout] = buildLanes(history({}, agents), ["scout"], NOW)!;
    const up = scout.cells.map((cell) => cell.up);
    expect(up[23]).toBe(true); // SCOUT-2 started half an hour ago
    expect(up[22]).toBe(false);
    expect(up[20] && up[21]).toBe(true); // SCOUT-1 covered these two (ended 2 h 10 min ago, started 3 h 10 min ago)
    expect(up[19]).toBe(false);
    // another role's session does not mark this lane
    expect(up.filter(Boolean)).toHaveLength(3);
  });

  it("covers no more than the team said of a session whose end nobody wrote", () => {
    const agents = { "SCOUT-1": { failed: [], sessions: [session(NOW - 5 * 3600, null, "unknown")] } };
    const [scout] = buildLanes(history({}, agents), ["scout"], NOW)!;
    expect(scout.cells.filter((cell) => cell.up)).toHaveLength(1);
  });
});
