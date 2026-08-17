/**
 * O-65 — il pannello "Feedback e richieste" renderizza i ticket nell'ordine
 * ricevuto dai lettori. La cronologia è `created_at`: `updated_at` cambia
 * quando un ticket vecchio viene assegnato o risolto e non deve riportarlo in
 * cima. I quattro record sono volutamente fuori ordine; due condividono la
 * stessa data per dimostrare il tie-break stabile sull'id.
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

const home = mkdtempSync(join(tmpdir(), "jht-ticket-order-"));
process.env.JHT_HOME = home;

const ticketRows = [
  {
    id: 9,
    position_id: 42,
    position_legacy_id: 42,
    request_text: "più vecchio",
    kind: "custom",
    status: "open",
    created_at: "2026-08-10T09:00:00Z",
  },
  {
    id: 2,
    position_id: 42,
    position_legacy_id: 42,
    request_text: "più recente, id minore",
    kind: "custom",
    status: "open",
    created_at: "2026-08-12T09:00:00Z",
  },
  {
    id: 7,
    position_id: 42,
    position_legacy_id: 42,
    request_text: "intermedio",
    kind: "custom",
    status: "open",
    created_at: "2026-08-11T09:00:00Z",
  },
  {
    id: 4,
    position_id: 42,
    position_legacy_id: 42,
    request_text: "più recente, id maggiore",
    kind: "custom",
    status: "open",
    created_at: "2026-08-12T09:00:00Z",
  },
];

const db = new Database(join(home, "jobs.db"));
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE positions (
    id INTEGER PRIMARY KEY, title TEXT, company TEXT, status TEXT,
    company_id INTEGER
  );
  CREATE TABLE scores (position_id INTEGER);
  CREATE TABLE position_highlights (position_id INTEGER, type TEXT);
  CREATE TABLE applications (position_id INTEGER);
  CREATE TABLE position_tickets (
    id INTEGER PRIMARY KEY, position_id INTEGER, request_text TEXT,
    kind TEXT, status TEXT, assigned_agent TEXT, response_text TEXT,
    created_at TEXT, resolved_at TEXT, updated_at TEXT
  );
  INSERT INTO positions (id, title, company, status)
  VALUES (42, 'Backend Engineer', 'ACME', 'ready');
`);
const insertTicket = db.prepare(`
  INSERT INTO position_tickets (
    id, position_id, request_text, kind, status, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
`);
for (const row of ticketRows) {
  // updated_at è deliberatamente opposto alla cronologia: usarlo farebbe
  // passare il test solo per caso se coincidessero.
  insertTicket.run(
    row.id,
    row.position_id,
    row.request_text,
    row.kind,
    row.status,
    row.created_at,
    `2026-08-${String(20 - row.id).padStart(2, "0")}T12:00:00Z`,
  );
}
db.close();

type Order = { column: string; ascending: boolean };
type Call = { table: string; orders: Order[] };

function fakeClient() {
  const calls: Call[] = [];
  const tables: Record<string, Array<Record<string, unknown>>> = {
    positions: [
      {
        id: "position-uuid",
        legacy_id: 42,
        title: "Backend Engineer",
        company: "ACME",
        status: "ready",
        company_id: null,
      },
    ],
    scores: [],
    position_highlights: [],
    applications: [],
    position_tickets: ticketRows,
    position_user_notes: [],
  };

  const client = {
    from(table: string) {
      const call: Call = { table, orders: [] };
      calls.push(call);
      const materialize = () => {
        const rows = [...(tables[table] ?? [])];
        return rows.sort((a, b) => {
          for (const order of call.orders) {
            const av = a[order.column];
            const bv = b[order.column];
            if (av === bv) continue;
            const direction = order.ascending ? 1 : -1;
            return (String(av) < String(bv) ? -1 : 1) * direction;
          }
          return 0;
        });
      };
      const response = () => ({ data: materialize(), error: null });
      const builder: Record<string, any> = {
        select: () => builder,
        eq: () => builder,
        is: () => builder,
        // Il lettore della pagina chiede anche l'ultima transizione a
        // «esclusa», e quella query è limitata a una riga: senza `limit` qui
        // il finto client fallisce dove quello vero funziona.
        limit: () => builder,
        order: (column: string, options: { ascending?: boolean } = {}) => {
          call.orders.push({ column, ascending: options.ascending !== false });
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
        ) => Promise.resolve(response()).then(ok, ko),
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

const expectedIds = ["4", "2", "7", "9"];

describe("ticket più recenti davanti nel pannello posizione", () => {
  it("SQLite ordina tre date non ordinate e risolve i pareggi per id", () => {
    const result = getPositionByIdLocal(home, "42");
    expect(result?.tickets.map((ticket) => ticket.id)).toEqual(expectedIds);
  });

  it("Supabase applica la stessa cronologia prima di costruire il pannello", async () => {
    const result = await getPositionById("position-uuid");
    expect(result?.tickets.map((ticket) => ticket.id)).toEqual(expectedIds);

    const ticketCall = supa.calls.find(
      (call) => call.table === "position_tickets",
    );
    expect(ticketCall?.orders).toEqual([
      { column: "created_at", ascending: false },
      { column: "id", ascending: false },
    ]);
  });
});
