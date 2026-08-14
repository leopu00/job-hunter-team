/**
 * O-41 — il riquadro «perché è esclusa» diceva QUANDO solo per le esclusioni
 * decise dall'utente, che hanno il proprio timbro atomico su
 * `user_excluded_at`. Quando a escludere è il TEAM quel campo resta vuoto:
 * l'Analista scrive stato e motivo, e l'ora della decisione finisce
 * nell'event-log (`position_state_transitions` nel jobs.db,
 * `position_transitions` sul cloud, mig 044).
 *
 * Qui si verifica la LETTURA su entrambe le sponde, con dati che rendono il
 * test capace di fallire: due esclusioni sulla stessa posizione (riaperta e
 * riesclusa — vale l'ultima) e una transizione a un altro stato, più recente
 * di entrambe, che non deve essere scambiata per un'esclusione.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const requireFromWeb = createRequire(
  join(__dirname, "../../../web/package.json"),
);
const Database = requireFromWeb("better-sqlite3");

const home = mkdtempSync(join(tmpdir(), "jht-exclusion-event-"));
process.env.JHT_HOME = home;

const OLD_EXCLUSION = "2026-07-02T08:15:00Z";
const LAST_EXCLUSION = "2026-08-11T17:20:00Z";
const LATER_OTHER_STATE = "2026-08-13T10:00:00Z";

const transitions = [
  {
    id: 1,
    position_id: 42,
    position_legacy_id: 42,
    to_state: "excluded",
    ts: OLD_EXCLUSION,
    by_agent: "analista-1",
  },
  {
    id: 2,
    position_id: 42,
    position_legacy_id: 42,
    to_state: "scored",
    ts: LATER_OTHER_STATE,
    by_agent: "scorer-2",
  },
  {
    id: 3,
    position_id: 42,
    position_legacy_id: 42,
    to_state: "excluded",
    ts: LAST_EXCLUSION,
    by_agent: "analista-3",
  },
];

const db = new Database(join(home, "jobs.db"));
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE positions (
    id INTEGER PRIMARY KEY, title TEXT, company TEXT, status TEXT,
    company_id INTEGER, updated_at TEXT, last_checked TEXT, found_at TEXT
  );
  CREATE TABLE scores (position_id INTEGER);
  CREATE TABLE position_highlights (position_id INTEGER, type TEXT);
  CREATE TABLE applications (position_id INTEGER);
  CREATE TABLE position_state_transitions (
    id INTEGER PRIMARY KEY, position_id INTEGER, from_state TEXT,
    to_state TEXT, ts TEXT, by_agent TEXT, notes TEXT
  );
  -- Le date della posizione sono tutte PIÙ RECENTI dell'esclusione: se il
  -- lettore ripiegasse su una di loro, il test se ne accorgerebbe.
  INSERT INTO positions (id, title, company, status, updated_at, last_checked, found_at)
  VALUES (42, 'Backend Engineer', 'ACME', 'excluded',
          '2026-08-14T09:00:00Z', '2026-08-14T09:00:00Z', '2026-08-14T09:00:00Z');
`);
const insert = db.prepare(
  "INSERT INTO position_state_transitions (id, position_id, to_state, ts, by_agent) VALUES (?, ?, ?, ?, ?)",
);
for (const t of transitions) {
  insert.run(t.id, t.position_id, t.to_state, t.ts, t.by_agent);
}
db.close();

type Filter = { column: string; value: unknown };
type Call = { table: string; filters: Filter[]; orders: string[] };

function fakeClient() {
  const calls: Call[] = [];
  const tables: Record<string, Array<Record<string, unknown>>> = {
    positions: [
      {
        id: "position-uuid",
        legacy_id: 42,
        title: "Backend Engineer",
        company: "ACME",
        status: "excluded",
        company_id: null,
        user_excluded_at: null,
        updated_at: "2026-08-14T09:00:00Z",
      },
    ],
    scores: [],
    position_highlights: [],
    applications: [],
    position_tickets: [],
    position_user_notes: [],
    position_transitions: transitions,
  };

  const client = {
    from(table: string) {
      const call: Call = { table, filters: [], orders: [] };
      calls.push(call);
      // I filtri vengono applicati davvero: un `eq` dimenticato nel codice
      // farebbe tornare la transizione sbagliata invece di passare comunque.
      const materialize = () => {
        let rows = [...(tables[table] ?? [])];
        for (const f of call.filters) {
          rows = rows.filter((r) => r[f.column] === f.value);
        }
        for (const column of [...call.orders].reverse()) {
          rows.sort((a, b) =>
            String(a[column]) < String(b[column]) ? 1 : -1,
          );
        }
        return rows;
      };
      const builder: Record<string, any> = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          call.filters.push({ column, value });
          return builder;
        },
        is: () => builder,
        not: () => builder,
        limit: () => builder,
        order: (column: string) => {
          call.orders.push(column);
          return builder;
        },
        single: async () => {
          const rows = materialize();
          return { data: rows[0] ?? null, error: rows.length ? null : {} };
        },
        maybeSingle: async () => ({
          data: materialize()[0] ?? null,
          error: null,
        }),
        then: (
          ok: (value: { data: unknown[]; error: null }) => unknown,
          ko?: (reason: unknown) => unknown,
        ) => Promise.resolve({ data: materialize(), error: null }).then(ok, ko),
      };
      return builder;
    },
  };
  return { client, calls };
}

const supa = fakeClient();

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
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => supa.client),
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: vi.fn() })),
  headers: vi.fn(async () => new Headers()),
}));

const { getPositionById } = await import("@/lib/queries");
const { getPositionByIdLocal } = await import("@/lib/local-queries");

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("ora dell'esclusione decisa dal team", () => {
  it("il jobs.db dà l'ULTIMA transizione a 'excluded'", () => {
    const result = getPositionByIdLocal(home, "42");
    expect(result?.exclusionEventAt).toBe(LAST_EXCLUSION);
  });

  it("Supabase legge la stessa cosa, filtrando su posizione e stato", async () => {
    const result = await getPositionById("position-uuid");
    expect(result?.exclusionEventAt).toBe(LAST_EXCLUSION);

    const call = supa.calls.find((c) => c.table === "position_transitions");
    expect(call?.filters).toEqual([
      { column: "position_legacy_id", value: 42 },
      { column: "to_state", value: "excluded" },
    ]);
    expect(call?.orders).toEqual(["ts"]);
  });

  it("un workspace senza event-log non inventa la data", async () => {
    // Il lettore risolve il jobs.db dall'ambiente al momento dell'import
    // (`JHT_HOME`), non dall'argomento: per un secondo workspace serve un
    // modulo nuovo, altrimenti il test leggerebbe il DB di sopra e
    // passerebbe senza aver provato niente.
    const bare = mkdtempSync(join(tmpdir(), "jht-exclusion-bare-"));
    const bareDb = new Database(join(bare, "jobs.db"));
    bareDb.pragma("journal_mode = WAL");
    bareDb.exec(`
      CREATE TABLE positions (
        id INTEGER PRIMARY KEY, title TEXT, company TEXT, status TEXT,
        company_id INTEGER, updated_at TEXT
      );
      CREATE TABLE scores (position_id INTEGER);
      CREATE TABLE position_highlights (position_id INTEGER, type TEXT);
      CREATE TABLE applications (position_id INTEGER);
      INSERT INTO positions (id, title, company, status, updated_at)
      VALUES (7, 'QA', 'ACME', 'excluded', '2026-08-14T09:00:00Z');
    `);
    bareDb.close();

    process.env.JHT_HOME = bare;
    vi.resetModules();
    const fresh = await import("@/lib/local-queries");
    const result = fresh.getPositionByIdLocal(bare, "7");
    process.env.JHT_HOME = home;

    // La posizione si legge (la pagina si apre), la data manca: tabella
    // assente vuol dire «non lo so», non «prendo un'altra data».
    expect(result?.position.title).toBe("QA");
    expect(result?.exclusionEventAt).toBeNull();
    rmSync(bare, { recursive: true, force: true });
  });
});
