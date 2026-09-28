/**
 * Posizioni viste lette dal cloud (`position_views`, mig 055): PostgREST
 * restituisce al massimo 1000 righe per risposta, anche a `.limit(10000)`.
 * Con una lettura secca un utente che ha aperto più di 1000 posizioni se ne
 * ritrova una parte segnata di nuovo «nuova».
 *
 * Il client finto applica l'ordine, le finestre inclusive di `.range()`, il
 * `.limit()` e il tetto di 1000 righe. Senza `.order()` ogni risposta rende le
 * righe in un ordine diverso, come può fare PostgreSQL fra una pagina e
 * l'altra: leggere a pagine senza ordine stabile perde righe anche qui.
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
let responses = 0;

function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a ?? "").localeCompare(String(b ?? ""));
}

function fakeClient() {
  return {
    from(table: string) {
      const call: QueryCall = { table, operations: [], ranges: [] };
      calls.push(call);
      const orders: Array<[string, boolean]> = [];
      let limit: number | null = null;
      let window: [number, number] | null = null;
      const record = (name: string, args: unknown[]) =>
        call.operations.push({ name, args });
      const builder: Record<string, any> = {
        select(...args: unknown[]) {
          record("select", args);
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
          let result = [...(tables[table] ?? [])];
          if (orders.length > 0) {
            result.sort((a, b) => {
              for (const [column, ascending] of orders) {
                const diff = compare(a[column], b[column]);
                if (diff !== 0) return ascending ? diff : -diff;
              }
              return 0;
            });
          } else if (result.length > 0) {
            // Nessun ordine chiesto: ogni risposta parte da un punto diverso.
            const shift = (responses * 337) % result.length;
            result = [...result.slice(shift), ...result.slice(0, shift)];
          }
          responses += 1;
          if (limit != null) result = result.slice(0, limit);
          if (window) result = result.slice(window[0], window[1] + 1);
          // Il tetto server-side: vale anche quando `.limit()` chiede di più.
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
vi.mock("@/lib/local-queries", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => fakeClient()),
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: vi.fn() })),
  headers: vi.fn(async () => new Headers()),
}));

const queries = await import("@/lib/queries");

const pad = (i: number) => String(i).padStart(5, "0");

beforeEach(() => {
  tables = { position_views: [] };
  calls = [];
  responses = 0;
});

describe("getSeenPositionIds", () => {
  it("la posizione vista alla riga 1201 di 1500 risulta vista", async () => {
    tables.position_views = Array.from({ length: 1500 }, (_, i) => ({
      user_id: "user-1",
      position_id: `pos-${pad(i)}`,
      viewed_at: new Date(Date.UTC(2026, 2, 1, 0, 0, i)).toISOString(),
    }));

    const seen = await queries.getSeenPositionIds();

    expect(seen.has(`pos-${pad(1200)}`)).toBe(true);
    expect(seen.size).toBe(1500);

    // Pagine consecutive, ordine chiuso sulla chiave primaria prima della
    // finestra, nessun `.limit()` che il server ignorerebbe comunque.
    const call = calls.find(
      (candidate) => candidate.table === "position_views",
    );
    expect(call?.ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    const names = call!.operations.map((operation) => operation.name);
    const orders = call!.operations
      .filter((operation) => operation.name === "order")
      .map((operation) => operation.args);
    expect(orders).toEqual([
      ["user_id", { ascending: true }],
      ["position_id", { ascending: true }],
    ]);
    expect(names.lastIndexOf("order")).toBeLessThan(names.indexOf("range"));
    expect(names).not.toContain("limit");
  });
});
