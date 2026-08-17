/**
 * O-98 — un full dump deve dimostrare di avere ricevuto tutte le righe.
 *
 * PostgREST può applicare un cap del servizio dopo la `.limit(10001)` della
 * route. Quel caso non restituisce un errore: arrivano le prime 1000 righe,
 * quindi guardare soltanto il limite richiesto lascia il restore convinto di
 * avere uno snapshot completo. Il finto client replica proprio quel confine:
 * il totale reale è 1628, ma il corpo della risposta ne contiene 1000.
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

function fullDumpAdmin(results: Record<string, Result>) {
  const selects: Array<{ table: string; columns: string; options: unknown }> =
    [];
  const limits: Array<{ table: string; value: number }> = [];
  const from = vi.fn((table: string) => {
    const builder = {
      select: vi.fn((columns: string, options: unknown) => {
        selects.push({ table, columns, options });
        return builder;
      }),
      eq: vi.fn(() => builder),
      is: vi.fn(() => builder),
      limit: vi.fn(async (value: number) => {
        limits.push({ table, value });
        const result = results[table];
        return { data: result.data, count: result.count, error: null };
      }),
    };
    return builder;
  });
  return { admin: { from }, selects, limits };
}

function rows(count: number) {
  return Array.from({ length: count }, (_, index) => ({ id: index }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkCloudSyncRateLimit.mockResolvedValue({ allowed: true });
});

describe("GET /api/cloud-sync/full-dump — completezza", () => {
  it("rifiuta le 1000 righe troncate dal servizio quando il totale reale è 1628", async () => {
    const db = fullDumpAdmin({
      positions: { data: rows(1000), count: 1628 },
      scores: { data: [], count: 0 },
      applications: { data: [], count: 0 },
    });
    mocks.verifyBearerToken.mockResolvedValue({
      ok: true,
      data: { userId: "user-test", tokenId: "device-test", admin: db.admin },
    });

    const { GET } = await import("@/app/api/cloud-sync/full-dump/route");
    const response = await GET(
      new Request("http://localhost/api/cloud-sync/full-dump") as never,
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "positions dump troncato (1000 di 1628 righe ricevute)",
    });
    expect(db.selects).toContainEqual({
      table: "positions",
      columns: "*",
      options: { count: "exact" },
    });
  });

  it("accetta una tabella di esattamente 1000 righe solo quando il totale conferma 1000", async () => {
    const db = fullDumpAdmin({
      positions: { data: rows(1000), count: 1000 },
      scores: { data: [], count: 0 },
      applications: { data: [], count: 0 },
    });
    mocks.verifyBearerToken.mockResolvedValue({
      ok: true,
      data: { userId: "user-test", tokenId: "device-test", admin: db.admin },
    });

    const { GET } = await import("@/app/api/cloud-sync/full-dump/route");
    const response = await GET(
      new Request("http://localhost/api/cloud-sync/full-dump") as never,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      totals: { positions: 1000, scores: 0, applications: 0 },
    });
    expect(db.limits).toContainEqual({ table: "positions", value: 10_001 });
  });
});
