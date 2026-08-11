/**
 * Test — la nota privata a BOX SPENTO (O-33, mig 069).
 *
 * Prima di O-33 il ramo `cloud` della route rispondeva 503 e il lettore cloud
 * non esisteva affatto: `userNote` era nel tipo di ritorno di
 * `getPositionById` ma nessuno lo riempiva. Effetto combinato: a box spento il
 * pannello si apriva SEMPRE vuoto e non salvava — e le due metà si
 * nascondevano a vicenda, perché un pannello vuoto è indistinguibile da «non
 * hai ancora scritto niente».
 *
 * Qui gira il codice, non i sorgenti (quelli li guarda
 * tasks/user-note-origin.test.ts). Il client Supabase è finto e REGISTRA le
 * query: quello che si asserisce è la forma della scrittura — su quale riga
 * cade, con quale conflitto, e cosa NON tocca — perché è lì che vivono i due
 * difetti che O-33 può reintrodurre:
 *
 *   1. un upsert dichiarato su (user_id, position_id) invece che sulla chiave
 *      completa: su Postgres non è un upsert impreciso, è un errore della
 *      query, e la nota tornerebbe non salvabile;
 *   2. una delete senza `origin`: cancellerebbe anche la riga dell'ALTRA
 *      superficie, cioè un testo che l'utente non ha davanti agli occhi.
 *
 * `localFirstWrite` è sostituito da una versione che chiama SOLO il callback
 * `cloud`: è il suo terzo ramo (browser senza SQLite), l'unico in cui la
 * tabella cloud viene toccata. Gli altri due rami restano provati dalla loro
 * suite — qui interessa il mondo a box spento.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const USER = "11111111-1111-1111-1111-111111111111";
const POS = "22222222-2222-2222-2222-222222222222";
const LEGACY = 42;
const NOW = "2026-08-11T10:00:00.000Z";

type Resolved = { data: unknown; error: { message: string } | null };

interface Call {
  table: string;
  op: "select" | "upsert" | "delete";
  filters: Record<string, unknown>;
  payload?: Record<string, unknown>;
  onConflict?: string;
}

/** Client Supabase finto: registra le chiamate e risponde da una tabella di
 *  esiti. Concatenabile e "thenable" perché il codice vero a volte chiude con
 *  `.single()`/`.maybeSingle()` e a volte fa `await` sulla catena (la delete). */
function fakeClient(resolve: (call: Call) => Resolved) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, op: "select", filters: {} };
      calls.push(call);
      const done = () => resolve(call);
      const b: Record<string, unknown> = {
        select: () => b,
        is: () => b,
        order: () => b,
        limit: () => b,
        eq: (k: string, v: unknown) => {
          call.filters[k] = v;
          return b;
        },
        upsert: (
          payload: Record<string, unknown>,
          opts?: { onConflict?: string },
        ) => {
          call.op = "upsert";
          call.payload = payload;
          call.onConflict = opts?.onConflict;
          return b;
        },
        delete: () => {
          call.op = "delete";
          return b;
        },
        single: async () => done(),
        maybeSingle: async () => done(),
        then: (ok: (r: Resolved) => unknown, ko?: (e: unknown) => unknown) =>
          Promise.resolve(done()).then(ok, ko),
      };
      return b;
    },
  };
  return { client, calls };
}

const ok = (data: unknown): Resolved => ({ data, error: null });
const boom = (message: string): Resolved => ({ data: null, error: { message } });

/** Esiti "tutto sano": la posizione c'è, la scrittura passa. */
function healthy(overrides: Partial<Record<string, Resolved>> = {}) {
  return (call: Call): Resolved => {
    const key = `${call.table}:${call.op}`;
    if (overrides[key]) return overrides[key];
    if (call.table === "positions") return ok({ id: POS });
    if (call.table === "position_user_notes") {
      if (call.op === "upsert")
        return ok({ body: call.payload!.body, updated_at: NOW });
      if (call.op === "delete") return ok(null);
      return ok(null);
    }
    return ok(null);
  };
}

let supa: ReturnType<typeof fakeClient>;

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(async () => null),
  isLocalRequest: vi.fn(async () => false),
}));
vi.mock("@/lib/demo/data", () => ({ isDemoLegacyId: vi.fn(() => false) }));
vi.mock("@/lib/demo/mode", () => ({
  activeDemoPersona: vi.fn(async () => null),
}));
vi.mock("@/lib/demo/queries", () => ({}));
// better-sqlite3 non si carica da qui, e in questi test non serve: il mondo
// sotto esame è quello SENZA jobs.db.
vi.mock("@/lib/local-queries", () => ({
  getPositionByIdLocal: vi.fn(),
}));
vi.mock("@/lib/workspace", () => ({
  getWorkspacePath: vi.fn(async () => null),
  workspaceHasDb: vi.fn(() => false),
  isSupabaseConfigured: true,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => supa.client),
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: vi.fn() })),
  headers: vi.fn(async () => new Headers()),
}));
vi.mock("@/lib/positions/local-first-write", () => ({
  localFirstWrite: vi.fn(
    async (
      _req: unknown,
      opts: {
        cloud: (c: unknown, u: string) => Promise<Record<string, unknown>>;
      },
    ) => {
      const step = (await opts.cloud(supa.client, USER)) as {
        ok: boolean;
        status?: number;
        body?: unknown;
        outcome?: unknown;
      };
      if (!step.ok) return Response.json(step.body, { status: step.status });
      return Response.json({
        ...(step.outcome as object),
        source: "cloud",
        cloud_synced: true,
      });
    },
  ),
}));

const { POST, DELETE } = await import(
  "@/app/api/positions/[legacyId]/user-note/route"
);
const { getPositionById } = await import("@/lib/queries");

function params(legacyId: number = LEGACY) {
  return { params: Promise.resolve({ legacyId: String(legacyId) }) };
}

function post(note: string, legacyId: number = LEGACY) {
  return POST(
    new Request("http://localhost/x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note }),
    }) as never,
    params(legacyId),
  );
}

function del(legacyId: number = LEGACY) {
  return DELETE(
    new Request("http://localhost/x", { method: "DELETE" }) as never,
    params(legacyId),
  );
}

function noteCalls() {
  return supa.calls.filter((c) => c.table === "position_user_notes");
}

beforeEach(() => {
  supa = fakeClient(healthy());
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("scrivere la nota a box spento", () => {
  it("salva, e la risposta contiene il testo salvato", async () => {
    const res = await post("ricordati del colloquio con Anna");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      id: String(LEGACY),
      note: "ricordati del colloquio con Anna",
      updated_at: NOW,
      source: "cloud",
    });
  });

  it("cade sulla riga della PROPRIA superficie", async () => {
    await post("nota dal sito");
    expect(noteCalls()[0].payload).toEqual({
      user_id: USER,
      position_id: POS,
      origin: "web",
      body: "nota dal sito",
    });
  });

  it("dichiara il conflitto sulla chiave completa", async () => {
    // Sulle sole (user_id, position_id) non esiste un vincolo unico: Postgres
    // non fa un upsert approssimativo, restituisce un errore — e la nota
    // tornerebbe non salvabile, che è il difetto originale di O-33 un
    // linguaggio più in là.
    await post("x");
    expect(noteCalls()[0].onConflict).toBe("user_id,position_id,origin");
  });

  it("trova la posizione per (user_id, legacy_id), non per legacy_id da solo", async () => {
    // `legacy_id` è un contatore per-box: senza `user_id` la stessa query
    // potrebbe indicare la posizione di un altro utente, e la RLS la
    // nasconderebbe soltanto — un 404 con il difetto nella query.
    await post("x");
    const lookup = supa.calls[0];
    expect(lookup.table).toBe("positions");
    expect(lookup.filters).toEqual({ user_id: USER, legacy_id: LEGACY });
  });

  it("una nota vuota non arriva nemmeno al cloud", async () => {
    const res = await post("   ");
    expect(res.status).toBe(400);
    expect(supa.calls).toHaveLength(0);
  });

  it("tronca a 4000 caratteri invece di rifiutare", async () => {
    await post("a".repeat(4100));
    expect((noteCalls()[0].payload!.body as string).length).toBe(4000);
  });
});

describe("cancellare la nota a box spento", () => {
  it("cancella e risponde con la nota assente", async () => {
    const res = await del();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      note: null,
      updated_at: null,
    });
  });

  it("cancella SOLO la riga della propria superficie", async () => {
    // Senza il filtro su `origin` porterebbe via anche la nota scritta sul
    // box: un testo che l'utente non ha davanti agli occhi, cancellato da un
    // bottone che parlava di quello che stava leggendo.
    await del();
    const call = noteCalls()[0];
    expect(call.op).toBe("delete");
    expect(call.filters).toEqual({
      user_id: USER,
      position_id: POS,
      origin: "web",
    });
  });
});

describe("quando qualcosa non c'è o non va", () => {
  it("posizione mai salita sul cloud: 404, non 500", async () => {
    supa = fakeClient(healthy({ "positions:select": ok(null) }));
    const res = await post("x");
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({
      error: `Posizione #${LEGACY} non trovata`,
    });
    // E non ha provato a scrivere una nota appesa al nulla.
    expect(noteCalls()).toHaveLength(0);
  });

  it("la stessa cosa vale per la cancellazione", async () => {
    supa = fakeClient(healthy({ "positions:select": ok(null) }));
    expect((await del()).status).toBe(404);
    expect(noteCalls()).toHaveLength(0);
  });

  it("query rotta sulla posizione: 500, senza dettagli nel corpo", async () => {
    supa = fakeClient(healthy({ "positions:select": boom("boom") }));
    const res = await post("x");
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "query_failed" });
  });

  it("upsert rifiutato: 500, e non finge di aver salvato", async () => {
    supa = fakeClient(
      healthy({ "position_user_notes:upsert": boom("rls denied") }),
    );
    const res = await post("x");
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining("rls denied"),
    });
  });

  it("delete rifiutata: 500, e non dice che la nota è sparita", async () => {
    supa = fakeClient(
      healthy({ "position_user_notes:delete": boom("rls denied") }),
    );
    expect((await del()).status).toBe(500);
  });
});

// ── Il lettore: metà del difetto pre-O-33 ──────────────────────────────
// Salvare senza rileggere avrebbe prodotto lo stesso pannello vuoto di prima,
// con la nota però al sicuro sul cloud: un difetto peggiore, perché indistinguibile
// dal precedente e con dentro il lavoro dell'utente.
function readerClient(note: Resolved) {
  return fakeClient((call) => {
    if (call.table === "positions")
      return ok({
        id: POS,
        legacy_id: LEGACY,
        company_id: null,
        title: "Backend Engineer",
        status: "ready",
      });
    if (call.table === "position_user_notes") return note;
    if (call.table === "position_highlights" || call.table === "position_tickets")
      return ok([]);
    return ok(null);
  });
}

describe("rileggere la nota a box spento", () => {
  it("il pannello si apre col testo che c'è sul cloud", async () => {
    supa = readerClient(ok({ body: "già scritta ieri", updated_at: NOW }));
    const data = await getPositionById(POS);
    expect(data?.userNote).toEqual({
      body: "già scritta ieri",
      updated_at: NOW,
    });
  });

  it("legge la riga della superficie giusta, per quella posizione", async () => {
    supa = readerClient(ok(null));
    await getPositionById(POS);
    const call = supa.calls.find((c) => c.table === "position_user_notes")!;
    expect(call.filters).toEqual({ position_id: POS, origin: "web" });
  });

  it("nessuna nota è `null`, e la pagina si apre lo stesso", async () => {
    supa = readerClient(ok(null));
    const data = await getPositionById(POS);
    expect(data).not.toBeNull();
    expect(data?.userNote).toBeNull();
  });

  it("tabella non ancora migrata: nessuna nota, non una pagina rotta", async () => {
    // La migration gira sul progetto Supabase, non insieme al deploy del sito:
    // fra i due c'è una finestra in cui la tabella non esiste ancora. La nota
    // è un riquadro della pagina, non la pagina.
    supa = readerClient(boom('relation "position_user_notes" does not exist'));
    const data = await getPositionById(POS);
    expect(data).not.toBeNull();
    expect(data?.userNote).toBeNull();
  });
});
