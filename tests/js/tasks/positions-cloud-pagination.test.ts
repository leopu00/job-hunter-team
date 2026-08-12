/**
 * O-63 — PostgREST restituisce al massimo 1000 righe anche quando la query non
 * dichiara un limite. Il pericolo è una risposta valida ma incompleta: grafici,
 * lista e mappa finiscono per descrivere tre universi diversi senza errori.
 *
 * Il client finto sotto applica davvero le finestre inclusive di `.range()`.
 * Ogni prova mette la riga 1001 nella seconda pagina e osserva il risultato
 * pubblico della funzione, non soltanto il fatto che il metodo sia stato
 * chiamato. Così una query che chiedesse due pagine ma scartasse la seconda non
 * potrebbe risultare verde.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, any>;
type Operation = { name: string; args: unknown[] };
type QueryCall = {
  table: string;
  columns: string;
  operations: Operation[];
  ranges: Array<[number, number]>;
};

let positionRows: Row[] = [];
let applicationRows: Row[] = [];

function rows(count = 1001): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `id-${i}`,
    legacy_id: i,
    title: `needle position ${i}`,
    company: "Acme",
    location: "Milano, Italia",
    remote_type: "hybrid",
    status: "ready",
    role_family: "Backend",
    loc_country: "Italia",
    loc_city: "Milano",
    source: "linkedin",
    score: 80,
    write_requested: false,
    found_at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
    found_by: "scout-1",
    last_checked: null,
    created_at: "2026-01-01T00:00:00.000Z",
    deleted_at: null,
    office_address: "Via Roma 1",
    office_lat: 45,
    office_lon: 9,
    scores: { total_score: 80, scored_at: null, scored_by: null },
    applications: {
      critic_score: 8,
      critic_verdict: "approved",
      written_at: null,
      written_by: null,
      critic_reviewed_at: null,
      reviewed_by: null,
      applied_at: null,
      response_at: null,
    },
  }));
}

function fakeClient() {
  const calls: QueryCall[] = [];
  const client = {
    from(table: string) {
      const call: QueryCall = {
        table,
        columns: "",
        operations: [],
        ranges: [],
      };
      calls.push(call);
      let window: [number, number] = [0, 999];
      const builder: Record<string, any> = {
        select(columns: string) {
          call.columns = columns;
          call.operations.push({ name: "select", args: [columns] });
          return builder;
        },
        is(...args: unknown[]) {
          call.operations.push({ name: "is", args });
          return builder;
        },
        not(...args: unknown[]) {
          call.operations.push({ name: "not", args });
          return builder;
        },
        in(...args: unknown[]) {
          call.operations.push({ name: "in", args });
          return builder;
        },
        or(...args: unknown[]) {
          call.operations.push({ name: "or", args });
          return builder;
        },
        order(...args: unknown[]) {
          call.operations.push({ name: "order", args });
          return builder;
        },
        limit(...args: unknown[]) {
          call.operations.push({ name: "limit", args });
          return builder;
        },
        range(from: number, to: number) {
          window = [from, to];
          call.ranges.push(window);
          call.operations.push({ name: "range", args: window });
          return builder;
        },
        then(
          ok: (result: { data: Row[]; error: null }) => unknown,
          ko?: (error: unknown) => unknown,
        ) {
          const source =
            table === "applications" ? applicationRows : positionRows;
          const [from, to] = window;
          return Promise.resolve({
            data: source.slice(from, to + 1),
            error: null,
          }).then(ok, ko);
        },
      };
      return builder;
    },
  };
  return { client, calls };
}

let supa: ReturnType<typeof fakeClient>;

vi.mock("@/lib/auth", () => ({ isLocalRequest: vi.fn(async () => false) }));
vi.mock("@/lib/workspace", () => ({
  getWorkspacePath: vi.fn(async () => null),
  workspaceHasDb: vi.fn(() => false),
  isSupabaseConfigured: true,
}));
vi.mock("@/lib/demo/mode", () => ({
  activeDemoPersona: vi.fn(async () => null),
}));
vi.mock("@/lib/demo/queries", () => ({}));
vi.mock("@/lib/local-queries", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => supa.client),
}));
vi.mock("@/lib/city-coords", () => ({
  resolveCityPins: vi.fn((input: Row[]) =>
    input.map((row) =>
      typeof row.office_lat === "number" && typeof row.office_lon === "number"
        ? { lat: row.office_lat, lon: row.office_lon }
        : null,
    ),
  ),
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: vi.fn() })),
  headers: vi.fn(async () => new Headers()),
}));

const queries = await import("@/lib/queries");

beforeEach(() => {
  positionRows = rows();
  applicationRows = positionRows.map((row) => ({
    position_id: row.id,
    status: "response",
    response: "yes",
    deleted_at: null,
  }));
  supa = fakeClient();
});

function expectTwoPages(table = "positions", index = 0) {
  const call = supa.calls.filter((candidate) => candidate.table === table)[
    index
  ];
  expect(call.ranges).toEqual([
    [0, 999],
    [1000, 1999],
  ]);
}

describe("le undici query cloud superano il tetto PostgREST", () => {
  it("getDashboardStats conta anche la riga 1001", async () => {
    await expect(queries.getDashboardStats()).resolves.toMatchObject({
      total: 1001,
    });
    expectTwoPages();
  });

  it("getPositionTypeDistribution aggrega anche la riga 1001", async () => {
    const result = await queries.getPositionTypeDistribution();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ family: "Backend", count: 1001 });
    expectTwoPages();
  });

  it("getPositionFacets restituisce anche la riga 1001", async () => {
    await expect(queries.getPositionFacets()).resolves.toHaveLength(1001);
    expectTwoPages();
  });

  it("getScoreDistribution conta anche la riga 1001", async () => {
    await expect(queries.getScoreDistribution()).resolves.toMatchObject({
      total: 1001,
      withScore: 1001,
    });
    expectTwoPages();
  });

  it("getSourceDistribution conta anche la riga 1001", async () => {
    await expect(queries.getSourceDistribution()).resolves.toEqual([
      { source: "linkedin", count: 1001 },
    ]);
    expectTwoPages();
  });

  it("getScoutStats pagina sia positions sia applications", async () => {
    await expect(queries.getScoutStats()).resolves.toEqual([
      {
        scout: "scout-1",
        total: 1001,
        active: 1001,
        excluded: 0,
        applied: 0,
        responded: 1001,
      },
    ]);
    expectTwoPages("positions");
    expectTwoPages("applications");
  });

  it("getPositions restituisce anche la riga 1001", async () => {
    await expect(queries.getPositions()).resolves.toHaveLength(1001);
    expectTwoPages();
  });

  it("getDashboardPositions restituisce anche la riga 1001", async () => {
    await expect(queries.getDashboardPositions()).resolves.toHaveLength(1001);
    expectTwoPages();
  });

  it("getPositionsWithCoords restituisce anche la riga 1001", async () => {
    await expect(queries.getPositionsWithCoords()).resolves.toHaveLength(1001);
    expectTwoPages();
  });

  it("getPositionLocations include la riga 1001 nell'albero", async () => {
    const result = await queries.getPositionLocations();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ country: "Italia", count: 1001 });
    expectTwoPages();
  });

  it("getPositionsWithoutCoords restituisce anche la riga 1001", async () => {
    positionRows = positionRows.map((row) => ({
      ...row,
      office_lat: null,
      office_lon: null,
      loc_country: null,
      loc_city: null,
    }));
    await expect(queries.getPositionsWithoutCoords()).resolves.toHaveLength(
      1001,
    );
    expectTwoPages();
  });
});

describe("filtri, ordine e finestra di getPositions", () => {
  it("cerca prima di paginare e conserva offset + limit oltre 1000", async () => {
    positionRows = rows(1600);
    const result = await queries.getPositions({
      q: "needle",
      statuses: ["ready"],
      limit: 1200,
      offset: 200,
    });

    expect(result).toHaveLength(1200);
    expect(result[0].id).toBe("id-200");
    expect(result.at(-1)?.id).toBe("id-1399");
    const call = supa.calls[0];
    expect(call.ranges).toEqual([
      [200, 1199],
      [1200, 1399],
    ]);
    const names = call.operations.map((operation) => operation.name);
    expect(names.indexOf("order")).toBeLessThan(names.indexOf("range"));
    expect(names.indexOf("in")).toBeLessThan(names.indexOf("range"));
    expect(names.indexOf("or")).toBeLessThan(names.indexOf("range"));
    expect(names.indexOf("limit")).toBeLessThan(names.indexOf("range"));
  });
});

describe("una sola implementazione del ciclo", () => {
  const source = readFileSync(
    resolve(__dirname, "../../../web/lib/queries.ts"),
    "utf-8",
  );

  it("il file contiene un solo punto che esegue range", () => {
    expect(source.match(/await query\.range\(/g)).toHaveLength(1);
  });

  it("getPositionById ed enrichRecent restano intenzionalmente fuori", () => {
    const byId = source.slice(
      source.indexOf("export async function getPositionById"),
      source.indexOf("// ── Score distribution"),
    );
    const enrich = source.slice(
      source.indexOf("async function enrichRecent"),
      source.indexOf("export async function getTeamActivity"),
    );
    expect(byId).not.toContain("fetchPostgrestRows");
    expect(enrich).not.toContain("fetchPostgrestRows");
  });
});
