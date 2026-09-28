/**
 * O-98 — un full dump deve dimostrare di avere ricevuto tutte le righe.
 *
 * PostgREST restituisce al massimo 1000 righe per risposta, qualunque
 * `.limit()` chieda la route. Il finto client replica proprio quel confine:
 * ogni risposta è una finestra `.range()` di al più 1000 righe, con il
 * totale reale in `count`. La route legge a pagine; il totale resta la prova
 * che tutte le righe siano arrivate.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyBearerToken: vi.fn(),
  checkCloudSyncRateLimit: vi.fn(),
}));

vi.mock("@/lib/cloud-sync/auth", () => ({
  verifyBearerToken: mocks.verifyBearerToken,
}));
vi.mock("@/lib/cloud-sync/rate-limit", () => ({
  checkCloudSyncRateLimit: mocks.checkCloudSyncRateLimit,
}));

type Result = { data: Record<string, unknown>[]; count: number | null };

const SERVICE_MAX_ROWS = 1000;

function fullDumpAdmin(results: Record<string, Result>) {
  const selects: Array<{ table: string; columns: string; options: unknown }> =
    [];
  const orders: Array<{ table: string; column: string }> = [];
  const pages: Array<{ table: string; after: unknown; limit: number }> = [];
  const filters: Array<{ table: string; op: string; args: unknown[] }> = [];
  const from = vi.fn((table: string) => {
    let after: unknown = null;
    const builder = {
      select: vi.fn((columns: string, options: unknown) => {
        selects.push({ table, columns, options });
        return builder;
      }),
      eq: vi.fn((...args: unknown[]) => {
        filters.push({ table, op: "eq", args });
        return builder;
      }),
      is: vi.fn((...args: unknown[]) => {
        filters.push({ table, op: "is", args });
        return builder;
      }),
      gt: vi.fn((_column: string, value: unknown) => {
        after = value;
        return builder;
      }),
      order: vi.fn((column: string) => {
        orders.push({ table, column });
        return builder;
      }),
      limit: vi.fn(async (n: number) => {
        pages.push({ table, after, limit: n });
        const result = results[table];
        const rest = result.data.filter(
          (r) => after === null || (r.id as number) > (after as number),
        );
        return {
          data: rest.slice(0, Math.min(n, SERVICE_MAX_ROWS)),
          count: result.count,
          error: null,
        };
      }),
    };
    return builder;
  });
  return { admin: { from }, selects, orders, pages, filters };
}

function rows(count: number) {
  return Array.from({ length: count }, (_, index) => ({ id: index }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkCloudSyncRateLimit.mockResolvedValue({ allowed: true });
});

async function dump(results: Record<string, Result>) {
  const db = fullDumpAdmin(results);
  mocks.verifyBearerToken.mockResolvedValue({
    ok: true,
    data: { userId: "user-test", tokenId: "device-test", admin: db.admin },
  });
  const { GET } = await import("@/app/api/cloud-sync/full-dump/route");
  const response = await GET(
    new Request("http://localhost/api/cloud-sync/full-dump") as never,
  );
  return { db, response };
}

const EMPTY = { data: [], count: 0 };

describe("GET /api/cloud-sync/full-dump — completezza", () => {
  it("restituisce tutte le 1628 posizioni, a pagine, quando il servizio ne dà 1000 per risposta", async () => {
    // Prima: `.limit(10001)` riceveva 1000 righe e rispondeva 413, e un
    // restore sopra 1000 posizioni vive era impossibile.
    const { db, response } = await dump({
      positions: { data: rows(1628), count: 1628 },
      scores: EMPTY,
      applications: EMPTY,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      totals: { positions: 1628, scores: 0, applications: 0 },
    });
    expect(body.dump.positions.map((r: { id: number }) => r.id)).toEqual(
      rows(1628).map((r) => r.id),
    );
    // Il totale si chiede una volta, alla prima pagina.
    expect(db.selects.filter((x) => x.table === "positions")).toEqual([
      { table: "positions", columns: "*", options: { count: "exact" } },
      { table: "positions", columns: "*", options: undefined },
    ]);
    // Client admin, niente RLS: ogni pagina è dell'utente e solo righe vive.
    const positionFilters = db.filters.filter((f) => f.table === "positions");
    expect(positionFilters).toEqual([
      { table: "positions", op: "eq", args: ["user_id", "user-test"] },
      { table: "positions", op: "is", args: ["deleted_at", null] },
      { table: "positions", op: "eq", args: ["user_id", "user-test"] },
      { table: "positions", op: "is", args: ["deleted_at", null] },
    ]);
    // Pagine stabili: ordine per una chiave unica.
    expect(db.orders).toContainEqual({ table: "positions", column: "id" });
    // Per chiave: la seconda pagina parte dall'ultimo id letto, non da un
    // offset che un push durante il restore sposterebbe.
    expect(db.pages.filter((p) => p.table === "positions")).toEqual([
      { table: "positions", after: null, limit: 1000 },
      { table: "positions", after: 999, limit: 1000 },
    ]);
  });

  it("rifiuta un dump in cui arrivano meno righe del totale dichiarato", async () => {
    // Righe sparite fra una pagina e l'altra, o una pagina persa: il totale
    // dice 1628, ne arrivano 1500. Un restore così non è uno snapshot.
    const { response } = await dump({
      positions: { data: rows(1500), count: 1628 },
      scores: EMPTY,
      applications: EMPTY,
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "positions dump troncato (1500 di 1628 righe ricevute)",
    });
  });

  it("rifiuta una tabella oltre il cap di 10000 righe", async () => {
    const { response } = await dump({
      positions: { data: rows(10_002), count: 10_002 },
      scores: EMPTY,
      applications: EMPTY,
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("positions oltre cap di 10000 righe"),
    });
  });

  it("senza il totale non dichiara completo niente", async () => {
    const { response } = await dump({
      positions: { data: rows(10), count: null },
      scores: EMPTY,
      applications: EMPTY,
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "positions_dump_count_unavailable",
    });
  });
});
