import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  getApplicationTimelineEvents,
  getDashboardPositions,
  getDashboardStats,
  getPositionTypeDistribution,
  getRecentPositions,
  getScoreDistribution,
  getSeenPositionIds,
  getSourceDistribution,
  type DashboardClient,
} from "./dashboard-data";

// A fake Supabase client that APPLIES the filters it is given (is / not /
// order / limit / range) to in-memory rows, so a query that forgot a filter
// returns the wrong rows instead of passing. Synthetic data only.

type Row = Record<string, any>;
type Op = { name: string; args: unknown[] };
type Call = { table: string; columns: string; ops: Op[]; ranges: number[][] };

function fakeClient(tables: Record<string, Row[]>, failOn?: string) {
  const calls: Call[] = [];
  const client: DashboardClient = {
    from(table: string) {
      const call: Call = { table, columns: "", ops: [], ranges: [] };
      calls.push(call);
      const filters: Array<(r: Row) => boolean> = [];
      const orders: Array<[string, boolean]> = [];
      let limit: number | null = null;

      const run = (from?: number, to?: number) => {
        if (failOn === table) {
          return Promise.resolve({ data: null, error: new Error("boom") });
        }
        let rows = (tables[table] ?? []).filter((r) =>
          filters.every((f) => f(r)),
        );
        rows = [...rows].sort((a, b) => {
          for (const [col, asc] of orders) {
            if (a[col] === b[col]) continue;
            const cmp = a[col] > b[col] ? 1 : -1;
            return asc ? cmp : -cmp;
          }
          return 0;
        });
        if (limit != null) rows = rows.slice(0, limit);
        if (from != null && to != null) rows = rows.slice(from, to + 1);
        return Promise.resolve({ data: rows, error: null });
      };

      const builder: any = {
        select(columns: string) {
          call.columns = columns;
          return builder;
        },
        is(col: string, value: unknown) {
          call.ops.push({ name: "is", args: [col, value] });
          filters.push((r) => (value === null ? r[col] == null : r[col] === value));
          return builder;
        },
        not(col: string, op: string, value: unknown) {
          call.ops.push({ name: "not", args: [col, op, value] });
          if (op === "eq") filters.push((r) => r[col] !== value);
          else if (op === "is" && value === null) filters.push((r) => r[col] != null);
          else throw new Error(`fake: not(${op}) unsupported`);
          return builder;
        },
        order(col: string, opts: { ascending: boolean }) {
          call.ops.push({ name: "order", args: [col, opts] });
          orders.push([col, opts.ascending]);
          return builder;
        },
        limit(n: number) {
          call.ops.push({ name: "limit", args: [n] });
          limit = n;
          return builder;
        },
        range(from: number, to: number) {
          call.ranges.push([from, to]);
          return run(from, to);
        },
        then(ok: any, ko: any) {
          return run().then(ok, ko);
        },
      };
      return builder;
    },
  };
  return { client, calls };
}

function position(i: number, extra: Row = {}): Row {
  return {
    id: `p-${String(i).padStart(5, "0")}`,
    legacy_id: i,
    title: `Role ${i}`,
    company: `Company ${i}`,
    location: "City",
    remote_type: "hybrid",
    status: "new",
    role_family: null,
    loc_country: "XX",
    loc_city: "City",
    source: "board-a",
    found_at: `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}Z`,
    found_by: "scout-1",
    last_checked: null,
    deleted_at: null,
    write_requested: false,
    scores: null,
    applications: null,
    ...extra,
  };
}

describe("getDashboardStats", () => {
  it("counts statuses, skips deleted rows, and splits scored by write_requested", async () => {
    const { client } = fakeClient({
      positions: [
        position(1, { status: "new" }),
        position(2, { status: "scored" }),
        position(3, { status: "scored", write_requested: true }),
        position(4, { status: "writing", write_requested: true }),
        position(5, { status: "excluded" }),
        position(6, { status: "applied", deleted_at: "2026-02-01T00:00:00Z" }),
      ],
    });
    await expect(getDashboardStats(client)).resolves.toEqual({
      total: 5,
      new: 1,
      checked: 0,
      scored: 2,
      writing: 1,
      review: 0,
      ready: 0,
      applied: 0,
      excluded: 1,
      response: 0,
      scored_open: 1,
      to_write: 2,
    });
  });

  it("reads past the 1000-row cap of PostgREST", async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => position(i));
    const { client, calls } = fakeClient({ positions: rows });
    const stats = await getDashboardStats(client);
    expect(stats.total).toBe(1001);
    expect(calls[0].ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("answers zeros on a query error", async () => {
    const { client } = fakeClient({}, "positions");
    const stats = await getDashboardStats(client);
    expect(stats.total).toBe(0);
    expect(stats.to_write).toBe(0);
  });
});

describe("getDashboardPositions", () => {
  it("maps score, critic, salary and last action, without excluded or deleted rows", async () => {
    const { client } = fakeClient({
      positions: [
        position(1, {
          status: "review",
          salary_declared_min: 12000,
          salary_declared_max: 24000,
          salary_declared_currency: "EUR",
          salary_estimated_min: 35000,
          salary_estimated_max: 60000,
          salary_estimated_currency: "USD",
          scores: [{ total_score: 81, scored_at: "2026-01-02T00:00:00Z", scored_by: "scorer-2" }],
          applications: [
            {
              critic_score: 7,
              critic_verdict: "PASS",
              written_at: "2026-01-03T00:00:00Z",
              written_by: "scrittore-1",
              critic_reviewed_at: "2026-01-04T00:00:00Z",
            },
          ],
        }),
        position(2, { status: "excluded" }),
        position(3, { deleted_at: "2026-02-01T00:00:00Z" }),
      ],
    });
    const out = await getDashboardPositions(client);
    expect(out.map((p) => p.id)).toEqual(["p-00001"]);
    expect(out[0]).toMatchObject({
      score: 81,
      scored_at: "2026-01-02T00:00:00Z",
      critic_score: 7,
      critic_verdict: "PASS",
      salary_min: 12000,
      salary_max: 24000,
      salary_currency: "EUR",
      last_action_at: "2026-01-04T00:00:00Z",
      last_action_by: "scrittore",
      last_action_actor: "scrittore-1",
    });
  });

  it("falls back to found_at and the scout when nothing else happened", async () => {
    const { client } = fakeClient({ positions: [position(1)] });
    const [p] = await getDashboardPositions(client);
    expect(p).toMatchObject({
      score: null,
      critic_score: null,
      salary_min: null,
      salary_currency: "EUR",
      last_action_at: p.found_at,
      last_action_by: "scout",
      last_action_actor: "scout-1",
    });
  });

  it("ends the order on the primary key and reads every page", async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => position(i));
    const { client, calls } = fakeClient({ positions: rows });
    await expect(getDashboardPositions(client)).resolves.toHaveLength(1001);
    const orders = calls[0].ops.filter((o) => o.name === "order");
    expect(orders.at(-1)?.args).toEqual(["id", { ascending: true }]);
    expect(calls[0].ranges).toHaveLength(2);
  });
});

describe("getRecentPositions", () => {
  it("returns the newest non-excluded rows, with the latest action", async () => {
    const { client } = fakeClient({
      positions: [
        position(1, { found_at: "2026-01-01T00:00:00Z" }),
        position(2, {
          found_at: "2026-01-05T00:00:00Z",
          last_checked: "2026-01-06T00:00:00Z",
          scores: { total_score: 70, scored_at: "2026-01-07T00:00:00Z" },
        }),
        position(3, { found_at: "2026-01-09T00:00:00Z", status: "excluded" }),
      ],
    });
    const out = await getRecentPositions(client, 1);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: "p-00002",
      score: 70,
      last_action_at: "2026-01-07T00:00:00Z",
    });
  });
});

describe("getSeenPositionIds", () => {
  it("returns the ids as strings", async () => {
    const { client } = fakeClient({
      position_views: [{ position_id: "a" }, { position_id: 42 }],
    });
    await expect(getSeenPositionIds(client)).resolves.toEqual(new Set(["a", "42"]));
  });

  it("answers an empty set on error", async () => {
    const { client } = fakeClient({}, "position_views");
    await expect(getSeenPositionIds(client)).resolves.toEqual(new Set());
  });
});

describe("getApplicationTimelineEvents", () => {
  it("keeps only submitted, not deleted applications, oldest first", async () => {
    const { client } = fakeClient({
      applications: [
        { id: "a2", applied_at: "2026-01-03T00:00:00Z", response: "yes", response_at: "2026-01-05T00:00:00Z", deleted_at: null },
        { id: "a1", applied_at: "2026-01-01T00:00:00Z", response: null, response_at: null, deleted_at: null },
        { id: "a3", applied_at: null, response: null, response_at: null, deleted_at: null },
        { id: "a4", applied_at: "2026-01-02T00:00:00Z", response: null, response_at: null, deleted_at: "2026-01-04T00:00:00Z" },
      ],
    });
    await expect(getApplicationTimelineEvents(client)).resolves.toEqual([
      { appliedAt: "2026-01-01T00:00:00Z", response: null, responseAt: null },
      { appliedAt: "2026-01-03T00:00:00Z", response: "yes", responseAt: "2026-01-05T00:00:00Z" },
    ]);
  });
});

describe("distributions", () => {
  const rows = [
    position(1, { source: "board-a", role_family: "Data", scores: { total_score: 90 }, applications: { critic_score: 8 } }),
    position(2, { source: "board-a", role_family: "Data", scores: { total_score: 50 } }),
    position(3, { source: "board-b", role_family: null, scores: { total_score: 0 } }),
    position(4, { source: null, role_family: "Ops" }),
    position(5, { source: "board-c", status: "excluded", scores: { total_score: 99 } }),
  ];

  it("getScoreDistribution buckets the positive scores of non-excluded rows", async () => {
    const { client } = fakeClient({ positions: rows });
    const d = await getScoreDistribution(client);
    expect(d.total).toBe(4);
    expect(d.withScore).toBe(2);
    expect(d.avgScore).toBe(70);
    expect(d.buckets.map((b) => b.count)).toEqual([1, 0, 1, 0]);
  });

  it("getSourceDistribution counts sources, unknown included, largest first", async () => {
    const { client } = fakeClient({ positions: rows });
    await expect(getSourceDistribution(client)).resolves.toEqual([
      { source: "board-a", count: 2 },
      { source: "board-b", count: 1 },
      { source: "sconosciuta", count: 1 },
    ]);
  });

  it("getPositionTypeDistribution aggregates role families", async () => {
    const { client } = fakeClient({ positions: rows });
    const out = await getPositionTypeDistribution(client);
    expect(out.map((f) => [f.family, f.count])).toEqual([
      ["Data", 2],
      ["Da categorizzare", 1],
      ["Ops", 1],
    ]);
    expect(out[0].avgScore).toBe(70);
    expect(out[0].avgCritic).toBe(8);
  });

  it("every distribution answers empty on error", async () => {
    const { client } = fakeClient({}, "positions");
    await expect(getScoreDistribution(client)).resolves.toMatchObject({ total: 0, buckets: [] });
    await expect(getSourceDistribution(client)).resolves.toEqual([]);
    await expect(getPositionTypeDistribution(client)).resolves.toEqual([]);
    await expect(getDashboardPositions(client)).resolves.toEqual([]);
    await expect(getRecentPositions(client)).resolves.toEqual([]);
  });
});

// The queries are a copy of the cloud branch of web/lib/queries.ts. This reads
// both sources and compares, function by function, the chain of Supabase calls
// (from / select / is / not / order / limit), so a select or a filter changed
// on one side only turns this red.
describe("the copy stays aligned with web/lib/queries.ts", () => {
  const WEB = readFileSync(
    resolve(__dirname, "../../../web/lib/queries.ts"),
    "utf-8",
  );
  const DESKTOP = readFileSync(
    resolve(__dirname, "dashboard-data.ts"),
    "utf-8",
  );

  function body(src: string, name: string): string {
    const start = src.indexOf(`export async function ${name}(`);
    expect(start, `${name} not found`).toBeGreaterThanOrEqual(0);
    // A top-level function closes with a "}" at column 0.
    const end = src.indexOf("\n}\n", start);
    expect(end, `${name} has no closing brace`).toBeGreaterThan(start);
    return src.slice(start, end);
  }

  function chain(src: string): string[] {
    // Quoted strings are taken whole: a select embeds "scores ( ... )".
    const re = /\.(from|select|is|not|order|limit)\(\s*((?:"[^"]*"|[^)"])*?)\s*\)/g;
    const out: string[] = [];
    for (const m of src.matchAll(re)) {
      out.push(`${m[1]}(${m[2].replace(/\s+/g, " ").replace(/,$/, "")})`);
    }
    return out;
  }

  const NAMES = [
    "getDashboardStats",
    "getRecentPositions",
    "getDashboardPositions",
    "getSeenPositionIds",
    "getApplicationTimelineEvents",
    "getScoreDistribution",
    "getSourceDistribution",
    "getPositionTypeDistribution",
  ];

  it.each(NAMES)("%s asks Supabase the same thing", (name) => {
    const desktop = chain(body(DESKTOP, name));
    // An empty extraction is not a match: it would compare nothing.
    expect(desktop.filter((c) => c.startsWith("select(")).length).toBe(1);
    expect(desktop).toEqual(chain(body(WEB, name)));
  });

  it("DashboardPosition has the same fields", () => {
    const fields = (src: string) => {
      const start = src.indexOf("export type DashboardPosition = {");
      const end = src.indexOf("\n};", start);
      return [...src.slice(start, end).matchAll(/^\s+(\w+)\??:/gm)].map((m) => m[1]);
    };
    const desktop = fields(DESKTOP);
    expect(desktop.length).toBeGreaterThan(20);
    expect(desktop).toEqual(fields(WEB));
  });
});
