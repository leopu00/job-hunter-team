import { describe, expect, it } from "vitest";
import { fakeSupabase, type FakeQuery, type FakeResult } from "../../test-support/fake-supabase";
import { loadAgentPanel, loadBoard, loadCvShelf, loadFoundPerDay, loadPhase, loadPlaces } from "./load-panels";

const USER = "00000000-0000-4000-8000-000000000001";

const position = (id: string, legacy: number, status: string, extra: object = {}) => ({
  id,
  legacy_id: legacy,
  title: `Role ${legacy}`,
  company: "Acme",
  status,
  location: null,
  remote_type: null,
  found_at: "2026-09-27T10:00:00Z",
  found_by: "scout-1",
  jd_summary: null,
  ...extra,
});

const isHead = (q: FakeQuery) => (q.op("select")?.[1] as { head?: boolean } | undefined)?.head === true;
const eqOf = (q: FakeQuery, col: string) => q.ops.filter(([op, a]) => op === "eq" && a[0] === col).map(([, a]) => a[1]);

/** Every query the panels send carries the user's id. */
function expectUserFilter(queries: FakeQuery[]) {
  expect(queries.length).toBeGreaterThan(0);
  for (const q of queries) expect(eqOf(q, "user_id"), `${q.table} ${JSON.stringify(q.ops)}`).toEqual([USER]);
}

describe("loadPhase (the piles' rule, pipeline_queue_defs.gd)", () => {
  it("a phase reads its status, the user's rows only, with score and application joined", async () => {
    const { client, queries } = fakeSupabase((q): FakeResult => {
      if (q.table === "positions") return { data: [position("p1", 1, "new")], error: null };
      if (q.table === "scores") return { data: [{ position_id: "p1", total_score: 71 }, { position_id: "p1", total_score: 80 }], error: null };
      return { data: [], error: null };
    }, USER);
    const list = await loadPhase(client, "scout");
    expect(list).toEqual([expect.objectContaining({ id: "p1", legacyId: 1, score: 80, verdict: null })]);
    const pos = queries.find((q) => q.table === "positions")!;
    expect(eqOf(pos, "status")).toEqual(["new"]);
    expect(pos.op("is")).toEqual(["deleted_at", null]);
    expectUserFilter(queries);
  });

  it("Scrittori = review and ready without PASS; Critici = ready with PASS", async () => {
    const respond = (q: FakeQuery): FakeResult => {
      if (q.table === "positions")
        return eqOf(q, "status")[0] === "review"
          ? { data: [position("r1", 1, "review")], error: null }
          : { data: [position("ok", 2, "ready"), position("no", 3, "ready")], error: null };
      if (q.table === "applications")
        return { data: [{ position_id: "ok", critic_verdict: "PASS" }, { position_id: "no", critic_verdict: "REVISE" }], error: null };
      return { data: [], error: null };
    };
    expect((await loadPhase(fakeSupabase(respond, USER).client, "scrittori")).map((p) => p.id)).toEqual(["r1", "no"]);
    expect((await loadPhase(fakeSupabase(respond, USER).client, "critici")).map((p) => p.id)).toEqual(["ok"]);
  });

  it("without a session nothing is read", async () => {
    const { client, queries } = fakeSupabase(() => ({ data: [], error: null }), null);
    await expect(loadPhase(client, "scout")).rejects.toThrow();
    expect(queries).toHaveLength(0);
  });
});

describe("loadAgentPanel", () => {
  it("its moves, and in its hands only what it moved last and is still where it left it", async () => {
    const mine = [
      { ts: "2026-09-27T12:00:00Z", by_agent: "scorer-2", from_state: "checked", to_state: "scored", position_legacy_id: 1 },
      { ts: "2026-09-27T11:00:00Z", by_agent: "scorer-2", from_state: "checked", to_state: "scored", position_legacy_id: 2 },
      { ts: "2026-09-27T10:00:00Z", by_agent: "scorer-2", from_state: "checked", to_state: "scored", position_legacy_id: 3 },
    ];
    const all = [
      mine[0],
      { ts: "2026-09-27T11:30:00Z", by_agent: "scrittore-1", from_state: "scored", to_state: "review", position_legacy_id: 2 },
      mine[1],
      mine[2],
    ];
    const { client, queries } = fakeSupabase((q): FakeResult => {
      if (q.table === "position_transitions") return { data: q.op("in") ? all : mine, error: null };
      if (q.table === "positions")
        return { data: [position("a", 1, "scored"), position("b", 2, "review"), position("c", 3, "ready")], error: null };
      return { data: [], error: null };
    }, USER);
    const panel = await loadAgentPanel(client, "scorer-2");
    expect(panel.moves.map((m) => m.position?.id)).toEqual(["a", "b", "c"]);
    // b: someone else moved it after; c: it moved on since (ready, not scored)
    expect(panel.inHand.map((p) => p.id)).toEqual(["a"]);
    expect(eqOf(queries[0]!, "by_agent")).toEqual(["scorer-2"]);
    expectUserFilter(queries);
  });

  it("an agent with no moves has nothing in hand, and no further query", async () => {
    const { client, queries } = fakeSupabase(() => ({ data: [], error: null }), USER);
    expect(await loadAgentPanel(client, "scout-9")).toEqual({ moves: [], inHand: [] });
    expect(queries).toHaveLength(1);
  });
});

describe("the objects' panels", () => {
  it("the CV shelf: the counts of the applications written, and the newest in their order", async () => {
    const { client, queries } = fakeSupabase((q): FakeResult => {
      if (q.table === "applications" && isHead(q)) {
        if (q.op("ilike")) return { data: null, error: null, count: 4 };
        if (q.ops.some(([op, a]) => op === "is" && a[0] === "critic_verdict")) return { data: null, error: null, count: 2 };
        return { data: null, error: null, count: 9 };
      }
      if (q.table === "applications") return { data: q.op("order") ? [{ position_id: "y" }, { position_id: "x" }] : [], error: null };
      if (q.table === "positions") return { data: [position("x", 1, "ready"), position("y", 2, "ready")], error: null };
      return { data: [], error: null };
    }, USER);
    const shelf = await loadCvShelf(client);
    expect({ written: shelf.written, passed: shelf.passed, unreviewed: shelf.unreviewed }).toEqual({ written: 9, passed: 4, unreviewed: 2 });
    expect(shelf.list.map((p) => p.id)).toEqual(["y", "x"]);
    expectUserFilter(queries);
  });

  it("the corkboard counts ready, sent and answered", async () => {
    const { client, queries } = fakeSupabase((q): FakeResult => {
      if (isHead(q)) return { data: null, error: null, count: { ready: 3, applied: 5, response: 1 }[eqOf(q, "status")[0] as string] ?? 0 };
      if (q.table === "positions") return { data: [position("p", 1, "applied")], error: null };
      return { data: [], error: null };
    }, USER);
    const board = await loadBoard(client);
    expect(board.counts).toEqual({ ready: 3, applied: 5, response: 1 });
    expect(board.list.map((p) => p.id)).toEqual(["p"]);
    expectUserFilter(queries);
  });

  it("the hologram: places by frequency, and how many positions have one", async () => {
    const { client, queries } = fakeSupabase((q): FakeResult => {
      if (isHead(q)) return { data: null, error: null, count: 4 };
      return { data: [{ location: "Roma" }, { location: " Milano " }, { location: "Roma" }, { location: "" }], error: null };
    }, USER);
    expect(await loadPlaces(client)).toEqual({ located: 4, places: [{ place: "Roma", n: 2 }, { place: "Milano", n: 1 }] });
    expectUserFilter(queries);
  });

  it("the Scout's week: one bar a day, days without finds at zero", async () => {
    const now = new Date(2026, 8, 27, 15, 0).getTime();
    const { client } = fakeSupabase(
      () => ({ data: [{ found_at: new Date(2026, 8, 27, 9).toISOString() }, { found_at: new Date(2026, 8, 25, 9).toISOString() }, { found_at: new Date(2026, 8, 25, 18).toISOString() }], error: null }),
      USER,
    );
    const week = await loadFoundPerDay(client, now);
    expect(week).toHaveLength(7);
    expect(week.at(-1)).toEqual({ day: "2026-09-27", n: 1 });
    expect(week.find((d) => d.day === "2026-09-25")?.n).toBe(2);
    expect(week[0]!.day).toBe("2026-09-21");
  });
});
