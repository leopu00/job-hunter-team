import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O-40 — i filtri "intelligenti" della sidebar (famiglia, paese, città,
 * fasce di score) sono applicati DOPO la lettura, in `applyFacetFilters`,
 * perché la stessa logica deve valere per Supabase e per SQLite. Ma nel ramo
 * locale il limite di pagina veniva passato alla lettura, cioè PRIMA del
 * filtro: si prendevano N righe qualsiasi e poi se ne scartava una parte.
 * Risultato: chiedendo 50 righe filtrate per una famiglia se ne ottenevano
 * meno — e le mancanti non erano "finite", erano state buttate prima di
 * essere guardate.
 *
 * È la stessa forma di O-37 (tagliare prima di aver deciso l'ordine), qui su
 * un filtro invece che su un ordinamento. Oggi non si vede perché la lista
 * chiede 2000 righe e pagina in memoria: è una falla che aspetta l'utente
 * con molte posizioni, non un difetto visibile stamattina.
 */
const received: Array<Record<string, unknown> | undefined> = [];

// 30 righe, famiglia alternata: Backend sulle pari, Frontend sulle dispari.
function rows() {
  return Array.from({ length: 30 }, (_, i) => ({
    id: String(i),
    legacy_id: i,
    title: `pos-${i}`,
    role_family: i % 2 === 0 ? "Backend" : "Frontend",
    status: "ready",
    found_at: `2026-03-${String(i + 1).padStart(2, "0")}T09:00:00Z`,
  }));
}

vi.mock("@/lib/local-queries", () => ({
  getPositionsLocal: vi.fn((_ws: string, opts?: Record<string, unknown>) => {
    received.push(opts);
    const all = rows();
    // Il vero `getPositionsLocal` onora limit/offset: se glieli si passa,
    // taglia lui — ed è esattamente il punto in discussione.
    const start = (opts?.offset as number) ?? 0;
    const limit = opts?.limit as number | undefined;
    return limit ? all.slice(start, start + limit) : all.slice(start);
  }),
  getPositionsWithCoordsLocal: vi.fn(),
  getSeenPositionIdsLocal: vi.fn(() => new Set()),
}));
vi.mock("@/lib/auth", () => ({ isLocalRequest: vi.fn(async () => true) }));
vi.mock("@/lib/workspace", () => ({
  getWorkspacePath: vi.fn(async () => "/fake/ws"),
  workspaceHasDb: vi.fn(() => true),
  isSupabaseConfigured: false,
}));
vi.mock("@/lib/demo/mode", () => ({ activeDemoPersona: vi.fn(async () => null) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: vi.fn() })),
  headers: vi.fn(async () => new Headers()),
}));

const { getPositions } = await import("@/lib/queries");

beforeEach(() => {
  received.length = 0;
});

describe("filtri sidebar + paginazione, ramo locale", () => {
  it("una pagina piena resta piena anche con un filtro attivo", async () => {
    const page = await getPositions({ families: ["Backend"], limit: 5 });
    expect(page).toHaveLength(5);
    expect(page.every((p) => p.role_family === "Backend")).toBe(true);
  });

  it("il limite non viene passato alla lettura, che filtra dopo", async () => {
    await getPositions({ families: ["Backend"], limit: 5 });
    expect(received[0]?.limit).toBeUndefined();
    expect(received[0]?.offset).toBeUndefined();
    // I filtri esprimibili in SQL invece devono continuare a scendere.
    await getPositions({ statuses: ["ready"], limit: 5 });
    expect(received[1]?.statuses).toEqual(["ready"]);
  });

  it("la seconda pagina continua la prima, sempre dentro il filtro", async () => {
    const first = await getPositions({ families: ["Backend"], limit: 5 });
    const second = await getPositions({
      families: ["Backend"],
      limit: 5,
      offset: 5,
    });
    expect(second).toHaveLength(5);
    expect(second.every((p) => p.role_family === "Backend")).toBe(true);
    const ids = new Set(first.map((p) => p.id));
    expect(second.some((p) => ids.has(p.id))).toBe(false);
  });

  it("senza filtri il conto non cambia", async () => {
    const page = await getPositions({ limit: 7 });
    expect(page).toHaveLength(7);
  });
});
