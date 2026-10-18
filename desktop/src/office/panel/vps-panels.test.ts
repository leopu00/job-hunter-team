import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PositionWithScore } from "@/lib/types";

// The office's panels over an existing team's VPS: the same lists and counts
// as the cloud's, from the list of positions the core serves. Synthetic rows.
const shared = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../../lib/existing-team-positions-shared", () => ({ readVpsPositionsShared: shared.read }));

import { boardOf, cvShelfOf, foundPerDayOf, panelPositionOf, phaseOf, placesOf, vpsPanelLoaders } from "./vps-panels";
import { PANEL_LIST_MAX } from "./load-panels";

let n = 0;
function row(over: Record<string, unknown> = {}): PositionWithScore {
  n++;
  return {
    id: String(n),
    legacy_id: n,
    title: `Ruolo ${n}`,
    company: `Azienda ${n}`,
    status: "new",
    location: null,
    remote_type: null,
    found_at: `2026-10-1${n % 10}T10:00:00Z`,
    score: undefined,
    write_requested: false,
    ...over,
  } as unknown as PositionWithScore;
}
const ids = (list: Array<{ id: string }>) => list.map((p) => p.id).sort((a, b) => Number(a) - Number(b));

beforeEach(() => {
  n = 0;
  shared.read.mockReset();
});

describe("the phases, as the piles count them", () => {
  const rows = [
    row({ status: "new" }), // 1
    row({ status: "checked" }), // 2
    row({ status: "scored", write_requested: false }), // 3
    row({ status: "scored", write_requested: true }), // 4: the user asked to write it: not on the scorer's pile
    row({ status: "review" }), // 5
    row({ status: "ready", critic_verdict: "pass" }), // 6
    row({ status: "ready", critic_verdict: "PASS" }), // 7
    row({ status: "ready", critic_verdict: "fail" }), // 8
    row({ status: "ready", critic_verdict: null }), // 9
    row({ status: "applied" }), // 10
  ];

  it("each pile is the positions of its phase", () => {
    expect(ids(phaseOf(rows, "scout"))).toEqual(["1"]);
    expect(ids(phaseOf(rows, "analisti"))).toEqual(["2"]);
    expect(ids(phaseOf(rows, "scorer"))).toEqual(["3"]);
    expect(ids(phaseOf(rows, "scrittori"))).toEqual(["5", "8", "9"]);
    expect(ids(phaseOf(rows, "critici"))).toEqual(["6", "7"]);
  });

  it("newest found first, at most the cloud's bound", () => {
    const many = Array.from({ length: PANEL_LIST_MAX + 25 }, (_, i) => row({ status: "new", found_at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString() }));
    const list = phaseOf(many, "scout");
    expect(list).toHaveLength(PANEL_LIST_MAX);
    expect(list[0].foundAt! > list[1].foundAt!).toBe(true);
    expect(list[0].foundAt).toBe(many.at(-1)!.found_at);
  });
});

describe("a position as the panel tells it", () => {
  it("carries what the list carries, and leaves empty what it does not: nothing is invented", () => {
    const p = panelPositionOf(row({ status: "ready", score: 83, critic_score: 7, critic_verdict: "pass", written_at: "2026-10-17T09:00:00Z", location: "Roma", remote_type: "hybrid" }));
    expect(p).toMatchObject({ id: "1", legacyId: 1, title: "Ruolo 1", status: "ready", score: 83, criticScore: 7, verdict: "pass", writtenAt: "2026-10-17T09:00:00Z", location: "Roma", remoteType: "hybrid" });
    expect(p.foundBy).toBeNull();
    expect(p.jdSummary).toBeNull();
    expect(p.writtenBy).toBeNull();
    expect(p.criticNotes).toBeNull();
    expect(p.reviewedBy).toBeNull();
    expect(p.reviewedAt).toBeNull();
  });

  it("a score that is not a number is no score", () => {
    expect(panelPositionOf(row({ score: "high" })).score).toBeNull();
    expect(panelPositionOf(row({ score: undefined })).score).toBeNull();
  });
});

describe("the CV shelf, the board and the places", () => {
  it("counts the CVs written, those with a pass, those with no verdict, and lists the newest written", () => {
    const rows = [
      row({ status: "review", written_at: "2026-10-10T10:00:00Z", critic_verdict: null }),
      row({ status: "ready", written_at: "2026-10-12T10:00:00Z", critic_verdict: "pass" }),
      row({ status: "ready", written_at: "2026-10-11T10:00:00Z", critic_verdict: "fail" }),
      row({ status: "scored" }), // never written
    ];
    const shelf = cvShelfOf(rows);
    expect({ written: shelf.written, passed: shelf.passed, unreviewed: shelf.unreviewed }).toEqual({ written: 3, passed: 1, unreviewed: 1 });
    expect(shelf.list.map((p) => p.writtenAt)).toEqual(["2026-10-12T10:00:00Z", "2026-10-11T10:00:00Z", "2026-10-10T10:00:00Z"]);
    expect(cvShelfOf([row()])).toEqual({ written: 0, passed: 0, unreviewed: 0, list: [] });
  });

  it("the board lists the positions ready, sent and answered, with their counts", () => {
    const rows = [row({ status: "ready" }), row({ status: "ready" }), row({ status: "applied" }), row({ status: "response" }), row({ status: "new" }), row({ status: "excluded" })];
    const board = boardOf(rows);
    expect(board.counts).toEqual({ ready: 2, applied: 1, response: 1 });
    expect(ids(board.list)).toEqual(["1", "2", "3", "4"]);
  });

  it("the places are the most frequent first, trimmed, and a position with no place is not a place", () => {
    const rows = [
      row({ location: "Roma" }), row({ location: " Roma " }), row({ location: "Milano" }),
      row({ location: "Torino" }), row({ location: "" }), row({ location: null }),
    ];
    expect(placesOf(rows)).toEqual({ located: 4, places: [{ place: "Roma", n: 2 }, { place: "Milano", n: 1 }, { place: "Torino", n: 1 }] });
    expect(placesOf(rows, 1).places).toEqual([{ place: "Roma", n: 2 }]);
  });

  it("positions found per calendar day over the last 7 days, oldest first", () => {
    const now = new Date(2026, 9, 18, 12, 0, 0).getTime();
    const at = (day: number, hour: number) => new Date(2026, 9, day, hour, 0, 0).toISOString();
    const rows = [row({ found_at: at(18, 9) }), row({ found_at: at(18, 11) }), row({ found_at: at(17, 23) }), row({ found_at: at(12, 8) }), row({ found_at: at(11, 23) }), row({ found_at: "not a date" })];
    const days = foundPerDayOf(rows, now);
    expect(days.map((d) => d.day)).toEqual(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"]);
    expect(days.map((d) => d.n)).toEqual([1, 0, 0, 0, 0, 1, 2]);
  });
});

describe("the readers over the shared read of the VPS", () => {
  it("serve the rows of the one shared read", async () => {
    shared.read.mockResolvedValue({ source: "vps", data: [row({ status: "new" }), row({ status: "applied" })] });
    expect((await vpsPanelLoaders.phase("scout")).map((p) => p.id)).toEqual(["1"]);
    expect((await vpsPanelLoaders.board()).counts.applied).toBe(1);
    expect(shared.read).toHaveBeenCalledTimes(2);
  });

  it("a read that failed throws its code: a team that could not be read is not an empty one", async () => {
    shared.read.mockResolvedValue({ source: "unavailable", code: "ssh_unavailable" });
    for (const load of [() => vpsPanelLoaders.phase("scout"), vpsPanelLoaders.cvShelf, vpsPanelLoaders.board, vpsPanelLoaders.places, () => vpsPanelLoaders.foundPerDay()]) {
      await expect(load()).rejects.toThrow("ssh_unavailable");
    }
    shared.read.mockResolvedValue({ source: "not_desktop" });
    await expect(vpsPanelLoaders.places()).rejects.toThrow("desktop_transport_unavailable");
  });
});
