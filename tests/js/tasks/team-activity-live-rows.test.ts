/**
 * Le route «attività» del team (scout, analista, scorer, scrittore) leggono
 * positions, scores e applications dal cloud. Il push container→cloud non
 * cancella mai: una riga eliminata in locale arriva come tombstone
 * (`deleted_at` valorizzato, migrazione 028). Una lettura che non filtra
 * `deleted_at` mostra nelle code e nei conteggi del team posizioni, score e
 * candidature che non esistono più.
 *
 * Il client finto sotto applica DAVVERO i filtri (`.is`, `.eq`, `.not`,
 * `.in`, `.gte`, `.lt`), l'ordine, `.limit()`, le finestre inclusive di
 * `.range()` e il tetto di 1000 righe che PostgREST impone anche a chi non
 * chiede un limite. Ogni prova guarda la risposta pubblica della route, non
 * le chiamate fatte al client.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, any>;

const PAGE_CAP = 1000;

let tables: Record<string, Row[]> = {};

function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

function fakeClient() {
  return {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      const orders: Array<[string, boolean]> = [];
      let head = false;
      let withCount = false;
      let limit: number | null = null;
      let window: [number, number] | null = null;
      const builder: Record<string, any> = {
        select(_columns: string, opts?: { count?: string; head?: boolean }) {
          head = opts?.head === true;
          withCount = opts?.count === "exact";
          return builder;
        },
        is(column: string, value: null) {
          if (value !== null) throw new Error(`is(${column}) solo con null`);
          filters.push((row) => row[column] == null);
          return builder;
        },
        eq(column: string, value: unknown) {
          filters.push((row) => row[column] === value);
          return builder;
        },
        not(column: string, operator: string, value: unknown) {
          if (operator === "eq") {
            filters.push((row) => row[column] !== value);
          } else if (operator === "is" && value === null) {
            filters.push((row) => row[column] != null);
          } else {
            throw new Error(`not(${column}, ${operator}) non supportato`);
          }
          return builder;
        },
        in(column: string, values: unknown[]) {
          filters.push((row) => values.includes(row[column]));
          return builder;
        },
        gte(column: string, value: unknown) {
          filters.push(
            (row) => row[column] != null && compare(row[column], value) >= 0,
          );
          return builder;
        },
        lt(column: string, value: unknown) {
          filters.push(
            (row) => row[column] != null && compare(row[column], value) < 0,
          );
          return builder;
        },
        order(column: string, opts?: { ascending?: boolean }) {
          orders.push([column, opts?.ascending !== false]);
          return builder;
        },
        limit(n: number) {
          limit = n;
          return builder;
        },
        range(from: number, to: number) {
          window = [from, to];
          return builder;
        },
        then(
          ok: (result: {
            data: Row[] | null;
            error: null;
            count: number | null;
          }) => unknown,
          ko?: (error: unknown) => unknown,
        ) {
          let result = (tables[table] ?? []).filter((row) =>
            filters.every((keep) => keep(row)),
          );
          if (orders.length > 0) {
            result = [...result].sort((a, b) => {
              for (const [column, ascending] of orders) {
                const diff = compare(a[column], b[column]);
                if (diff !== 0) return ascending ? diff : -diff;
              }
              return 0;
            });
          }
          const count = withCount ? result.length : null;
          if (limit != null) result = result.slice(0, limit);
          if (window) result = result.slice(window[0], window[1] + 1);
          // Il tetto server-side: vale anche senza limite dichiarato.
          result = result.slice(0, PAGE_CAP);
          return Promise.resolve({
            data: head ? null : result,
            error: null,
            count,
          }).then(ok, ko);
        },
      };
      return builder;
    },
  };
}

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn(async () => null) }));
vi.mock("@/lib/local-workspace", () => ({
  readLocalOr: vi.fn(async () => null),
}));
vi.mock("@/lib/local-queries", () => ({
  categorizeExclusion: (notes: string | null) => notes ?? "ALTRO",
  getScoutActivityLocal: vi.fn(),
  getAnalistaActivityLocal: vi.fn(),
  getScorerActivityLocal: vi.fn(),
  getScrittoreActivityLocal: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => fakeClient()),
}));

const scout = await import("@/app/api/scout/activity/route");
const analista = await import("@/app/api/analista/activity/route");
const scorer = await import("@/app/api/scorer/activity/route");
const scrittore = await import("@/app/api/scrittore/activity/route");

const NOW = new Date().toISOString();
const TOMBSTONE = "2026-01-01T00:00:00.000Z";

function position(id: string, status: string, extra: Row = {}): Row {
  return {
    id,
    title: `title ${id}`,
    company: "Acme",
    location: "Milano",
    remote_type: "hybrid",
    source: "linkedin",
    status,
    found_at: NOW,
    found_by: "scout-1",
    last_checked: NOW,
    notes: null,
    deleted_at: null,
    ...extra,
  };
}

function ids(list: Row[]): string[] {
  return list.map((row) => row.id).sort();
}

async function body(route: { GET: () => Promise<Response> }) {
  const res = await route.GET();
  expect(res.status).toBe(200);
  return res.json();
}

beforeEach(() => {
  tables = { positions: [], scores: [], applications: [] };
});

describe("scout/activity", () => {
  it("una posizione cancellata non compare in coda, feed, escluse e conteggi", async () => {
    tables.positions = [
      position("new-live", "new"),
      position("new-dead", "new", { deleted_at: TOMBSTONE }),
      position("excl-live", "excluded"),
      position("excl-dead", "excluded", { deleted_at: TOMBSTONE }),
    ];

    const out = await body(scout);

    expect(ids(out.queue)).toEqual(["new-live"]);
    expect(ids(out.recent)).toEqual(["new-live"]);
    expect(ids(out.excluded_today)).toEqual(["excl-live"]);
    expect(out.stats).toEqual({ found_today: 2, total_new: 1 });
  });
});

describe("analista/activity", () => {
  it("una posizione cancellata non compare in code, liste, conteggi e categorie", async () => {
    tables.positions = [
      position("new-live", "new"),
      position("new-dead", "new", { deleted_at: TOMBSTONE }),
      position("chk-live", "checked"),
      position("chk-dead", "checked", { deleted_at: TOMBSTONE }),
      position("excl-live", "excluded", { notes: "SENIORITY" }),
      position("excl-dead", "excluded", {
        notes: "LINGUA",
        deleted_at: TOMBSTONE,
      }),
    ];

    const out = await body(analista);

    expect(ids(out.queue)).toEqual(["new-live"]);
    expect(ids(out.recent_processed)).toEqual(["chk-live"]);
    expect(ids(out.recent_excluded)).toEqual(["excl-live"]);
    expect(out.queue_size).toBe(1);
    expect(out.checked_total).toBe(1);
    expect(out.analyzed_today).toBe(1);
    expect(out.excluded_today).toBe(1);
    expect(out.exclusion_categories).toEqual({ SENIORITY: 1 });
  });

  it("le categorie contano anche l'esclusa numero 1001 di oggi", async () => {
    tables.positions = Array.from({ length: 1001 }, (_, i) =>
      position(`excl-${String(i).padStart(4, "0")}`, "excluded", {
        notes: "SENIORITY",
      }),
    );

    const out = await body(analista);

    expect(out.excluded_today).toBe(1001);
    expect(out.exclusion_categories).toEqual({ SENIORITY: 1001 });
  });
});

describe("scorer/activity", () => {
  function score(id: string, total: number, extra: Row = {}): Row {
    return {
      id,
      position_id: `pos-${id}`,
      total_score: total,
      scored_at: NOW,
      scored_by: "scorer-1",
      positions: {
        title: `title ${id}`,
        company: "Acme",
        location: "",
        remote_type: "",
      },
      deleted_at: null,
      ...extra,
    };
  }

  it("uno score o una posizione cancellati non compaiono in liste e statistiche", async () => {
    tables.positions = [
      position("chk-live", "checked"),
      position("chk-dead", "checked", { deleted_at: TOMBSTONE }),
    ];
    tables.scores = [
      score("hi-live", 80),
      score("hi-dead", 90, { deleted_at: TOMBSTONE }),
      score("lo-live", 20),
      score("lo-dead", 10, { deleted_at: TOMBSTONE }),
    ];

    const out = await body(scorer);

    expect(ids(out.queue)).toEqual(["chk-live"]);
    expect(ids(out.recent_scored)).toEqual(["pos-hi-live"]);
    expect(ids(out.recent_excluded)).toEqual(["pos-lo-live"]);
    expect(out.stats).toEqual({
      queue_size: 1,
      scored_total: 2,
      scored_today: 2,
      excluded_today: 1,
      avg_score_today: 50,
    });
  });

  it("le statistiche di oggi contano anche lo score numero 1001", async () => {
    tables.scores = Array.from({ length: 1001 }, (_, i) =>
      score(`s-${String(i).padStart(4, "0")}`, i < 1000 ? 80 : 20),
    );

    const out = await body(scorer);

    expect(out.stats.scored_today).toBe(1001);
    expect(out.stats.excluded_today).toBe(1);
  });
});

describe("scrittore/activity", () => {
  function application(id: string, extra: Row = {}): Row {
    return {
      id,
      position_id: `pos-${id}`,
      written_at: NOW,
      critic_score: 8,
      critic_reviewed_at: NOW,
      deleted_at: null,
      ...extra,
    };
  }

  it("posizioni e candidature cancellate non compaiono in code, liste e conteggi", async () => {
    const scores = { total_score: 70 };
    const applications = { written_by: "scrittore-1", critic_score: 8 };
    tables.positions = [
      position("sc-live", "scored", { scores }),
      position("sc-dead", "scored", { scores, deleted_at: TOMBSTONE }),
      position("wr-live", "writing", { scores, applications }),
      position("wr-dead", "writing", {
        scores,
        applications,
        deleted_at: TOMBSTONE,
      }),
      position("rd-live", "ready", { scores, applications }),
      position("rd-dead", "ready", {
        scores,
        applications,
        deleted_at: TOMBSTONE,
      }),
    ];
    tables.applications = [
      application("a-live"),
      application("a-dead", { critic_score: 2, deleted_at: TOMBSTONE }),
    ];

    const out = await body(scrittore);

    expect(ids(out.queue)).toEqual(["sc-live"]);
    expect(ids(out.in_progress)).toEqual(["wr-live"]);
    expect(ids(out.recent_completed)).toEqual(["rd-live"]);
    expect(out.queue_size).toBe(1);
    expect(out.writing_today).toBe(1);
    expect(out.completed_today).toBe(1);
    expect(out.avg_critic_score).toBe(8);
  });

  it("la media critica di oggi conta anche oltre la riga 1000", async () => {
    tables.applications = Array.from({ length: 2000 }, (_, i) =>
      application(`a-${String(i).padStart(4, "0")}`, {
        critic_score: i < 1000 ? 5 : 9,
      }),
    );

    const out = await body(scrittore);

    expect(out.completed_today).toBe(2000);
    expect(out.avg_critic_score).toBe(7);
  });
});
