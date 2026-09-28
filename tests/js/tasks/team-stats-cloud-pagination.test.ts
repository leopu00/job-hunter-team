/**
 * Statistiche e attività del team lette dal cloud: PostgREST restituisce al
 * massimo 1000 righe per risposta, anche senza un limite dichiarato, e il push
 * container→cloud non cancella mai (una riga eliminata arriva come tombstone,
 * `deleted_at` valorizzato). Una lettura secca dà numeri calcolati sulle prime
 * 1000 righe; una lettura senza `deleted_at is null` conta righe che non
 * esistono più.
 *
 * Il client finto applica davvero i filtri (`.is`, `.not`, `.or`, `.in`,
 * `.gte`, `.lt`), l'ordine, le finestre inclusive di `.range()` e il tetto di
 * 1000 righe, che vale anche quando nessuno chiede un limite. Ogni prova guarda
 * il risultato pubblico (statistiche, eventi, risposta della route).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, any>;
type QueryCall = {
  table: string;
  operations: Array<{ name: string; args: unknown[] }>;
  ranges: Array<[number, number]>;
};

const PAGE_CAP = 1000;

let tables: Record<string, Row[]> = {};
let calls: QueryCall[] = [];

function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a ?? "").localeCompare(String(b ?? ""));
}

// Solo le due forme usate dalle query sotto prova: `col.eq.val` e
// `col.not.is.null`, in OR fra loro.
function orFilter(expr: string): (row: Row) => boolean {
  const parts = expr.split(",").map((part) => {
    const eq = part.match(/^(\w+)\.eq\.(.+)$/);
    if (eq) return (row: Row) => String(row[eq[1]]) === eq[2];
    const notNull = part.match(/^(\w+)\.not\.is\.null$/);
    if (notNull) return (row: Row) => row[notNull[1]] != null;
    throw new Error(`or(${part}) non supportato`);
  });
  return (row) => parts.some((keep) => keep(row));
}

function fakeClient() {
  return {
    from(table: string) {
      const call: QueryCall = { table, operations: [], ranges: [] };
      calls.push(call);
      const filters: Array<(row: Row) => boolean> = [];
      const orders: Array<[string, boolean]> = [];
      let limit: number | null = null;
      let window: [number, number] | null = null;
      const record = (name: string, args: unknown[]) =>
        call.operations.push({ name, args });
      // Le relazioni incluse, come PostgREST: `rel!inner` toglie la riga
      // quando la relazione non passa il filtro, `rel` toglie solo il figlio.
      const inner = new Set<string>();
      const embedded: Array<(row: Row) => Row> = [];
      const builder: Record<string, any> = {
        select(...args: unknown[]) {
          record("select", args);
          for (const m of String(args[0]).matchAll(/(\w+)\s*!inner/g))
            inner.add(m[1]);
          return builder;
        },
        is(column: string, value: null) {
          record("is", [column, value]);
          if (value !== null) throw new Error(`is(${column}) solo con null`);
          const [rel, field] = column.split(".");
          if (field === undefined) {
            filters.push((row) => row[column] == null);
          } else if (inner.has(rel)) {
            filters.push((row) =>
              [row[rel]]
                .flat()
                .some((child) => child != null && child[field] == null),
            );
          } else {
            embedded.push((row) => {
              const kept = [row[rel]]
                .flat()
                .filter((child) => child != null && child[field] == null);
              return {
                ...row,
                [rel]: Array.isArray(row[rel]) ? kept : (kept[0] ?? null),
              };
            });
          }
          return builder;
        },
        not(column: string, operator: string, value: unknown) {
          record("not", [column, operator, value]);
          if (operator === "eq") {
            filters.push((row) => row[column] !== value);
          } else if (operator === "is" && value === null) {
            filters.push((row) => row[column] != null);
          } else {
            throw new Error(`not(${column}, ${operator}) non supportato`);
          }
          return builder;
        },
        or(expr: string) {
          record("or", [expr]);
          filters.push(orFilter(expr));
          return builder;
        },
        in(column: string, values: unknown[]) {
          record("in", [column, values]);
          filters.push((row) => values.includes(row[column]));
          return builder;
        },
        gte(column: string, value: unknown) {
          record("gte", [column, value]);
          filters.push(
            (row) => row[column] != null && compare(row[column], value) >= 0,
          );
          return builder;
        },
        lt(column: string, value: unknown) {
          record("lt", [column, value]);
          filters.push(
            (row) => row[column] != null && compare(row[column], value) < 0,
          );
          return builder;
        },
        order(column: string, opts?: { ascending?: boolean }) {
          record("order", [column, opts]);
          orders.push([column, opts?.ascending !== false]);
          return builder;
        },
        limit(n: number) {
          record("limit", [n]);
          limit = n;
          return builder;
        },
        range(from: number, to: number) {
          record("range", [from, to]);
          window = [from, to];
          call.ranges.push(window);
          return builder;
        },
        then(
          ok: (result: { data: Row[]; error: null }) => unknown,
          ko?: (error: unknown) => unknown,
        ) {
          let result = (tables[table] ?? [])
            .map((row) => embedded.reduce((r, filter) => filter(r), row))
            .filter((row) => filters.every((keep) => keep(row)));
          if (orders.length > 0) {
            result = [...result].sort((a, b) => {
              for (const [column, ascending] of orders) {
                const diff = compare(a[column], b[column]);
                if (diff !== 0) return ascending ? diff : -diff;
              }
              return 0;
            });
          }
          if (limit != null) result = result.slice(0, limit);
          if (window) result = result.slice(window[0], window[1] + 1);
          // Il tetto server-side: vale anche senza limite dichiarato e anche
          // quando `.limit()` chiede di più.
          result = result.slice(0, PAGE_CAP);
          return Promise.resolve({ data: result, error: null }).then(ok, ko);
        },
      };
      return builder;
    },
  };
}

vi.mock("@/lib/auth", () => ({
  isLocalRequest: vi.fn(async () => false),
  requireAuth: vi.fn(async () => null),
}));
vi.mock("@/lib/workspace", () => ({
  getWorkspacePath: vi.fn(async () => null),
  workspaceHasDb: vi.fn(() => false),
  isSupabaseConfigured: true,
}));
vi.mock("@/lib/local-workspace", () => ({
  readLocalOr: vi.fn(async () => null),
}));
vi.mock("@/lib/demo/mode", () => ({
  activeDemoPersona: vi.fn(async () => null),
}));
vi.mock("@/lib/demo/queries", () => ({}));
vi.mock("@/lib/local-queries", () => ({
  getCriticoActivityLocal: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => fakeClient()),
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: vi.fn() })),
  headers: vi.fn(async () => new Headers()),
}));

const queries = await import("@/lib/queries");
const critico = await import("@/app/api/critico/route");

const TOMBSTONE = "2026-02-01T00:00:00.000Z";
const pad = (i: number) => String(i).padStart(5, "0");
const at = (i: number) => new Date(Date.UTC(2026, 2, 1, 0, 0, i)).toISOString();

function score(i: number, extra: Row = {}): Row {
  return {
    id: `score-${pad(i)}`,
    position_id: `pos-${pad(i)}`,
    scored_at: at(i),
    scored_by: "scorer-1",
    total_score: 50,
    deleted_at: null,
    ...extra,
  };
}

// Pagine consecutive, ordine chiuso sulla colonna unica prima della finestra.
function expectStablePages(table: string, pages: Array<[number, number]>) {
  const call = calls.find(
    (candidate) => candidate.table === table && candidate.ranges.length > 0,
  );
  expect(call?.ranges).toEqual(pages);
  const names = call!.operations.map((operation) => operation.name);
  const orders = call!.operations.filter(
    (operation) => operation.name === "order",
  );
  expect(orders.at(-1)?.args).toEqual(["id", { ascending: true }]);
  expect(names.lastIndexOf("order")).toBeLessThan(names.indexOf("range"));
  expect(names).not.toContain("limit");
}

beforeEach(() => {
  tables = {
    positions: [],
    scores: [],
    applications: [],
    position_transitions: [],
  };
  calls = [];
});

describe("getScorerStats", () => {
  it("statistiche su tutti i 1500 score vivi, non sulle prime 1000 righe", async () => {
    tables.scores = [
      score(0, { deleted_at: TOMBSTONE, total_score: 0 }),
      ...Array.from({ length: 1500 }, (_, i) =>
        score(i + 1, { total_score: i < 1000 ? 50 : 90 }),
      ),
    ];

    await expect(queries.getScorerStats()).resolves.toEqual([
      {
        scorer: "scorer-1",
        total: 1500,
        avgScore: 63,
        high: 500,
        mid: 1000,
        low: 0,
      },
    ]);
    expectStablePages("scores", [
      [0, 999],
      [1000, 1999],
    ]);
  });
});

describe("getTeamActivity", () => {
  const range = { from: "2026-01-01", to: "2026-12-31" };

  it("conta e mostra anche gli eventi oltre la riga 1000 della finestra", async () => {
    tables.scores = Array.from({ length: 1500 }, (_, i) => score(i));

    const act = await queries.getTeamActivity(range);

    expect(act.roleTotals.scorer).toBe(1500);
    expect(act.totalAll).toBe(1500);
    expect(act.timeline).toHaveLength(1500);
    // L'evento più recente è la riga 1500: sta nella seconda pagina.
    expect(act.recent[0].pid).toBe(`pos-${pad(1499)}`);
    expectStablePages("scores", [
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("uno score cancellato non si conta", async () => {
    tables.scores = [score(0), score(1, { deleted_at: TOMBSTONE }), score(2)];

    const act = await queries.getTeamActivity(range);

    expect(act.roleTotals.scorer).toBe(2);
    expect(act.timeline.map((event) => event.pid)).not.toContain(
      `pos-${pad(1)}`,
    );
  });
});

describe("getTeamActivityLog", () => {
  it("restituisce anche gli eventi oltre la riga 1000", async () => {
    tables.scores = Array.from({ length: 1500 }, (_, i) => score(i));

    const log = await queries.getTeamActivityLog();

    expect(log).toHaveLength(1500);
    expect(log[0].pid).toBe(`pos-${pad(1499)}`);
    expectStablePages("scores", [
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("uno score cancellato non compare", async () => {
    tables.scores = [score(0), score(1, { deleted_at: TOMBSTONE }), score(2)];

    const log = await queries.getTeamActivityLog();

    expect(log.map((event) => event.pid).sort()).toEqual([
      `pos-${pad(0)}`,
      `pos-${pad(2)}`,
    ]);
  });
});

describe("/api/critico", () => {
  const VERDICTS = ["PASS", "NEEDS_WORK", "REJECT"];

  function application(i: number, extra: Row = {}): Row {
    return {
      id: `app-${pad(i)}`,
      status: "ready",
      critic_score: 7,
      critic_verdict: VERDICTS[i % 3],
      critic_round: 1,
      critic_reviewed_at: at(i),
      written_at: at(i),
      written_by: "scrittore-1",
      reviewed_by: "critico-1",
      deleted_at: null,
      positions: { id: `pos-${pad(i)}`, title: `t ${i}`, company: "Acme" },
      ...extra,
    };
  }

  async function body() {
    const res = await critico.GET();
    expect(res.status).toBe(200);
    return res.json();
  }

  it("conta tutti i 1200 verdetti, non le prime 1000 righe", async () => {
    tables.applications = Array.from({ length: 1200 }, (_, i) =>
      application(i),
    );

    const json = await body();

    expect(json.stats).toMatchObject({
      total: 1200,
      pass: 400,
      needsWork: 400,
      reject: 400,
      avgScore: 7,
    });
    expect(json.byAgent).toEqual([
      {
        critico: "critico-1",
        total: 1200,
        pass: 400,
        needsWork: 400,
        reject: 400,
      },
    ]);
    // Il feed resta sulle revisioni più recenti, cioè in coda alla tabella.
    expect(json.feed[0].id).toBe(`app-${pad(1199)}`);
    expectStablePages("applications", [
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("un verdetto cancellato non si conta e non compare nel feed", async () => {
    tables.applications = [
      application(0),
      application(3, { deleted_at: TOMBSTONE }),
      application(1),
    ];

    const json = await body();

    expect(json.stats).toMatchObject({
      total: 2,
      pass: 1,
      needsWork: 1,
      reject: 0,
    });
    expect(json.feed.map((row: Row) => row.id)).not.toContain(`app-${pad(3)}`);
  });

  it("la candidatura viva di una posizione cancellata non si conta e non compare nel feed", async () => {
    tables.applications = [
      application(0),
      application(3, {
        positions: {
          id: `pos-${pad(3)}`,
          title: "t 3",
          company: "Acme",
          deleted_at: TOMBSTONE,
        },
      }),
      application(1),
    ];

    const json = await body();

    expect(json.stats).toMatchObject({
      total: 2,
      pass: 1,
      needsWork: 1,
      reject: 0,
    });
    expect(json.feed.map((row: Row) => row.id)).not.toContain(`app-${pad(3)}`);
  });
});

describe("relazioni incluse in queries.ts: un figlio cancellato non parla per una posizione viva", () => {
  it("getDashboardPositions: uno score o una candidatura cancellati non danno punteggio né verdetto", async () => {
    tables.positions = [
      {
        id: "p-live",
        legacy_id: 1,
        status: "ready",
        found_at: at(1),
        deleted_at: null,
        scores: {
          total_score: 80,
          scored_at: at(1),
          scored_by: "scorer-1",
          deleted_at: null,
        },
        applications: {
          critic_score: 8,
          critic_verdict: "PASS",
          deleted_at: null,
        },
      },
      {
        id: "p-orphan",
        legacy_id: 2,
        status: "ready",
        found_at: at(2),
        deleted_at: null,
        scores: {
          total_score: 90,
          scored_at: at(2),
          scored_by: "scorer-1",
          deleted_at: TOMBSTONE,
        },
        applications: {
          critic_score: 2,
          critic_verdict: "REJECT",
          deleted_at: TOMBSTONE,
        },
      },
    ];

    const rows = await queries.getDashboardPositions();
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));

    expect(byId["p-live"]).toMatchObject({
      score: 80,
      critic_score: 8,
      critic_verdict: "PASS",
    });
    expect(byId["p-orphan"]).toMatchObject({
      score: null,
      critic_score: null,
      critic_verdict: null,
    });
  });

  it("feed: l'evento di una posizione cancellata tiene il titolo ma non il link", async () => {
    tables.scores = [score(0), score(1)];
    tables.positions = [
      {
        id: `pos-${pad(0)}`,
        legacy_id: 10,
        title: "viva",
        company: "Acme",
        deleted_at: null,
      },
      {
        id: `pos-${pad(1)}`,
        legacy_id: 11,
        title: "cancellata",
        company: "Acme",
        deleted_at: TOMBSTONE,
      },
    ];

    const act = await queries.getTeamActivity({
      from: "2026-01-01",
      to: "2026-12-31",
    });
    const byTitle = Object.fromEntries(act.recent.map((e) => [e.title, e]));

    expect(byTitle["viva"].pid).toBe(`pos-${pad(0)}`);
    expect(byTitle["cancellata"].pid).toBeNull();
  });
});
