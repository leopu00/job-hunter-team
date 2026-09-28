import { afterEach, describe, expect, it } from "vitest";
import { fakeSupabase, type FakeQuery, type FakeResult } from "../../test-support/fake-supabase";
import { loadAgentPanel, loadBoard, loadCvShelf, loadFoundPerDay, loadPhase, loadPlaces, PAGE_ROWS, PAGES_MAX, readAllPages } from "./load-panels";

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

/**
 * Every query the panels send carries the user's id, and every read of
 * positions or applications leaves the deleted rows out.
 */
function expectUserFilter(queries: FakeQuery[]) {
  expect(queries.length).toBeGreaterThan(0);
  for (const q of queries) {
    expect(eqOf(q, "user_id"), `${q.table} ${JSON.stringify(q.ops)}`).toEqual([USER]);
    if (q.table === "positions" || q.table === "applications")
      expect(q.ops.some(([op, a]) => op === "is" && a[0] === "deleted_at" && a[1] === null), `${q.table} without deleted_at: ${JSON.stringify(q.ops)}`).toBe(true);
  }
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
    // the deleted positions' applications are left out by the same query, before the limit and in the counts
    const apps = queries.filter((q) => q.table === "applications" && !q.op("in"));
    expect(apps).toHaveLength(4);
    for (const q of apps) {
      expect(String(q.op("select")?.[0])).toContain("positions!inner(id)");
      expect(q.ops.some(([op, a]) => op === "is" && a[0] === "positions.deleted_at" && a[1] === null), JSON.stringify(q.ops)).toBe(true);
    }
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
      const all = [{ id: "a", location: "Roma" }, { id: "b", location: " Milano " }, { id: "c", location: "Roma" }, { id: "d", location: "" }];
      return { data: q.op("gt") ? [] : all, error: null };
    }, USER);
    expect(await loadPlaces(client)).toEqual({ located: 4, places: [{ place: "Roma", n: 2 }, { place: "Milano", n: 1 }] });
    expectUserFilter(queries);
  });

  it("the hologram reads every located position, page after page by id, past the server's 1000 rows", async () => {
    // 2500 positions: 700 in Roma first, then 1800 in Milano. The first 1000
    // rows alone (700 Roma, 300 Milano) would put Roma first.
    const id = (i: number) => `p${String(i).padStart(5, "0")}`;
    const table = [...Array(700).fill("Roma"), ...Array(1800).fill("Milano")].map((location, i) => ({ id: id(i), location }));
    for (const maxRows of [1000, 400]) {
      const { client, queries } = fakeSupabase((q): FakeResult => {
        if (isHead(q)) return { data: null, error: null, count: table.length };
        const after = q.op("gt")?.[1] as string | undefined;
        const limit = q.op("limit")?.[0] as number;
        return { data: table.filter((r) => after === undefined || r.id > after).slice(0, Math.min(limit, maxRows)), error: null };
      }, USER);
      const { located, places } = await loadPlaces(client);
      expect(located).toBe(2500);
      expect(places).toEqual([{ place: "Milano", n: 1800 }, { place: "Roma", n: 700 }]);
      const pages = queries.filter((q) => !isHead(q));
      expect(pages.map((q) => q.op("gt")?.[1] ?? null)).toEqual([
        null,
        ...Array.from({ length: Math.ceil(2500 / maxRows) }, (_, i) => id(Math.min((i + 1) * maxRows, 2500) - 1)),
      ]);
      expect(pages.every((q) => q.op("order")?.[0] === "id" && q.op("limit")?.[0] === PAGE_ROWS)).toBe(true);
      expectUserFilter(queries);
    }
  });

  it("a position found between two pages neither doubles a row nor drops one", async () => {
    const table = Array.from({ length: 1500 }, (_, i) => ({ id: `p${String(i * 2).padStart(5, "0")}`, location: "Roma" }));
    let pages = 0;
    const { client } = fakeSupabase((q): FakeResult => {
      if (isHead(q)) return { data: null, error: null, count: table.length };
      pages += 1;
      // after the first page, the scout finds one whose id sorts before it
      if (pages === 2) table.splice(1, 0, { id: "p00001", location: "Milano" });
      const after = q.op("gt")?.[1] as string | undefined;
      return { data: table.filter((r) => after === undefined || r.id > after).slice(0, 1000), error: null };
    }, USER);
    // by offset the second page would start one row early and read p01998 twice
    expect((await loadPlaces(client)).places).toEqual([{ place: "Roma", n: 1500 }]);
  });

  it("reading pages stops at an empty page, and at PAGES_MAX whatever comes", async () => {
    let calls = 0;
    const empty = await readAllPages(async () => ((calls += 1), { data: [], error: null }));
    expect([empty, calls]).toEqual([[], 1]);
    calls = 0;
    await readAllPages(async () => ((calls += 1), { data: [{ id: `x${calls}` }], error: null }));
    expect(calls).toBe(PAGES_MAX);
  });
});

describe("the Scout's week", () => {
  const TZ = process.env.TZ;
  afterEach(() => {
    if (TZ === undefined) delete process.env.TZ;
    else process.env.TZ = TZ;
  });

  /** Answers each day's head request with the finds in its [gte, lt) window. */
  function scoutWeek(found: Date[]) {
    return fakeSupabase((q): FakeResult => {
      const gte = Date.parse(q.op("gte")?.[1] as string);
      const lt = Date.parse(q.op("lt")?.[1] as string);
      return { data: null, error: null, count: found.filter((d) => d.getTime() >= gte && d.getTime() < lt).length };
    }, USER);
  }

  it("one bar a day, counted by the server, days without finds at zero", async () => {
    const now = new Date(2026, 8, 27, 15, 0).getTime();
    const { client, queries } = scoutWeek([new Date(2026, 8, 27, 9), new Date(2026, 8, 25, 9), new Date(2026, 8, 25, 18)]);
    const week = await loadFoundPerDay(client, now);
    expect(week).toHaveLength(7);
    expect(week.at(-1)).toEqual({ day: "2026-09-27", n: 1 });
    expect(week.find((d) => d.day === "2026-09-25")?.n).toBe(2);
    expect(week[0]!.day).toBe("2026-09-21");
    expect(queries.every((q) => isHead(q))).toBe(true);
    expectUserFilter(queries);
  });

  it("the weeks of the clock change: seven different days, today last, each from its own midnight", async () => {
    process.env.TZ = "Europe/Rome";
    // 25/10/2026: a day of 25 hours (a find at 23:30 belongs to it); 28/03/2027: a day of 23 hours
    const autumn = await loadFoundPerDay(scoutWeek([new Date(2026, 9, 25, 23, 30), new Date(2026, 9, 26, 0, 30)]).client, new Date(2026, 9, 27, 15).getTime());
    expect(autumn).toEqual([
      { day: "2026-10-21", n: 0 },
      { day: "2026-10-22", n: 0 },
      { day: "2026-10-23", n: 0 },
      { day: "2026-10-24", n: 0 },
      { day: "2026-10-25", n: 1 },
      { day: "2026-10-26", n: 1 },
      { day: "2026-10-27", n: 0 },
    ]);
    const spring = await loadFoundPerDay(scoutWeek([new Date(2027, 2, 29, 0, 30)]).client, new Date(2027, 2, 30, 0, 30).getTime());
    expect(spring.map((d) => d.day)).toEqual(["2027-03-24", "2027-03-25", "2027-03-26", "2027-03-27", "2027-03-28", "2027-03-29", "2027-03-30"]);
    expect(spring.find((d) => d.day === "2027-03-29")?.n).toBe(1);
  });

  it("where the clock changes at midnight (Santiago, 06/09/2026), the other days keep their own midnight", async () => {
    process.env.TZ = "America/Santiago";
    // today's midnight does not exist (00:00 -> 01:00): a find at 00:30 on 02/09 is still of 02/09
    const week = await loadFoundPerDay(scoutWeek([new Date(2026, 8, 2, 0, 30)]).client, new Date(2026, 8, 6, 15).getTime());
    expect(week.map((d) => d.day)).toEqual(["2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06"]);
    expect(week.find((d) => d.day === "2026-09-02")?.n).toBe(1);
  });
});
