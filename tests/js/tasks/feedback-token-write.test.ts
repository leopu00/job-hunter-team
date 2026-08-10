/**
 * Il 403 tolto dalla POST del feedback: cosa apre, e cosa NON apre.
 *
 * Fino al 2026-08-10 `app/api/positions/[legacyId]/feedback/route.ts`
 * rifiutava con 403 chiunque non arrivasse da una sessione browser. Il
 * vincolo esisteva per impedire che qualcosa registrasse un giudizio al posto
 * dell'utente; è caduto su decisione esplicita dell'operatore, perché doveva
 * fermare le azioni NON richieste, non impedire all'utente di farsi aiutare da
 * `jht` (o da un agente che guida `jht` per suo conto).
 *
 * Un guard di scrittura rimosso senza un test che ne descriva il nuovo confine
 * è indistinguibile da una svista di sicurezza. Questo file è quel confine:
 *
 *  1. un token di dispositivo può registrare un giudizio;
 *  2. l'identità viene dal token VERIFICATO, mai dal corpo della richiesta —
 *     per un attore token il client Supabase è service_role e scavalca la RLS,
 *     quindi un `user_id` preso dal payload lascerebbe votare per chiunque;
 *  3. la validazione è la stessa per i due attori: un token non può scrivere
 *     azioni, punteggi o direzioni che il browser non potrebbe;
 *  4. l'apertura riguarda SOLO questa POST — le altre route con lo stesso
 *     guard restano session-only, e l'ultimo blocco lo verifica sul sorgente.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const teamAuth = vi.hoisted(() => ({ resolveUser: vi.fn() }));
const demo = vi.hoisted(() => ({
  isDemoLegacyId: vi.fn(() => false),
  activeDemoPersona: vi.fn(async () => false),
  parseDemoFeedback: vi.fn(() => ({})),
  serializeDemoFeedback: vi.fn(() => ""),
  DEMO_FEEDBACK_COOKIE: "jht_demo_feedback",
}));

vi.mock("@/lib/team-state/auth", () => teamAuth);
vi.mock("@/lib/demo/data", () => ({ isDemoLegacyId: demo.isDemoLegacyId }));
vi.mock("@/lib/demo/mode", () => ({
  activeDemoPersona: demo.activeDemoPersona,
  parseDemoFeedback: demo.parseDemoFeedback,
  serializeDemoFeedback: demo.serializeDemoFeedback,
  DEMO_FEEDBACK_COOKIE: demo.DEMO_FEEDBACK_COOKIE,
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: vi.fn(), set: vi.fn() })),
}));

import { POST } from "@/app/api/positions/[legacyId]/feedback/route";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, "../../../web");

/** Un finto Supabase che registra cosa è stato inserito. */
function recordingDb() {
  const inserted: Record<string, unknown>[] = [];
  const single = vi.fn(async () => ({
    data: { id: "fb-1", ...inserted[inserted.length - 1] },
    error: null,
  }));
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn((row: Record<string, unknown>) => {
    inserted.push(row);
    return { select };
  });
  return { supabase: { from: vi.fn(() => ({ insert })) }, inserted };
}

function asToken(db: ReturnType<typeof recordingDb>, userId = "user-token") {
  teamAuth.resolveUser.mockResolvedValue({
    ok: true,
    user: { source: "token", userId, supabase: db.supabase, token: {} },
  });
}

function asSession(db: ReturnType<typeof recordingDb>, userId = "user-session") {
  teamAuth.resolveUser.mockResolvedValue({
    ok: true,
    user: { source: "session", userId, supabase: db.supabase },
  });
}

function request(body: unknown) {
  return new Request("http://localhost/api/positions/12345/feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

const params = { params: Promise.resolve({ legacyId: "12345" }) };

beforeEach(() => {
  vi.clearAllMocks();
  demo.isDemoLegacyId.mockReturnValue(false);
  demo.activeDemoPersona.mockResolvedValue(false);
});

describe("un token di dispositivo può registrare il giudizio dell'utente", () => {
  it("accetta il like e non risponde più 403", async () => {
    const db = recordingDb();
    asToken(db);

    const res = await POST(request({ action: "like" }), params);

    expect(res.status).toBe(200);
    expect(db.inserted).toHaveLength(1);
    expect(db.inserted[0]).toMatchObject({
      action: "like",
      position_legacy_id: "12345",
    });
  });

  it.each(["like", "dislike", "hide", "star", "clear"])(
    "accetta l'azione %s, come dal browser",
    async (action) => {
      const db = recordingDb();
      asToken(db);
      const res = await POST(request({ action }), params);
      expect(res.status).toBe(200);
      expect(db.inserted[0]).toMatchObject({ action });
    },
  );

  it("porta i campi estesi fino all'insert", async () => {
    const db = recordingDb();
    asToken(db);
    await POST(
      request({
        action: "star",
        score: 5,
        direction: "more_like_this",
        reason: "perfetta",
        comment: "stack giusto",
      }),
      params,
    );
    expect(db.inserted[0]).toMatchObject({
      score: 5,
      direction: "more_like_this",
      reason: "perfetta",
      comment: "stack giusto",
    });
  });
});

describe("l'identità viene dal token, non da chi scrive il body", () => {
  it("usa lo userId verificato", async () => {
    const db = recordingDb();
    asToken(db, "il-vero-utente");
    await POST(request({ action: "like" }), params);
    expect(db.inserted[0].user_id).toBe("il-vero-utente");
  });

  it("un user_id nel body non sposta il voto su un altro account", async () => {
    // Per un attore token il client è service_role e scavalca la RLS: se
    // l'identità arrivasse dal payload, un token qualunque potrebbe votare
    // per chiunque. È il difetto che questo test esiste per impedire.
    const db = recordingDb();
    asToken(db, "il-vero-utente");
    await POST(
      request({ action: "like", user_id: "vittima", userId: "vittima" }),
      params,
    );
    expect(db.inserted[0].user_id).toBe("il-vero-utente");
  });
});

describe("la validazione non si allenta per il token", () => {
  it.each([
    ["azione inventata", { action: "sabotage" }],
    ["azione assente", {}],
    ["azione non stringa", { action: 7 }],
  ])("rifiuta con 400: %s", async (_label, body) => {
    const db = recordingDb();
    asToken(db);
    const res = await POST(request(body), params);
    expect(res.status).toBe(400);
    expect(db.inserted).toHaveLength(0);
  });

  it.each([0, 6, -1, 99])("rifiuta il punteggio %i", async (score) => {
    const db = recordingDb();
    asToken(db);
    const res = await POST(request({ action: "star", score }), params);
    expect(res.status).toBe(400);
    expect(db.inserted).toHaveLength(0);
  });

  it("rifiuta una direction sconosciuta", async () => {
    const db = recordingDb();
    asToken(db);
    const res = await POST(
      request({ action: "like", direction: "sideways" }),
      params,
    );
    expect(res.status).toBe(400);
  });

  it("un body non parsabile resta un 400 anche col token", async () => {
    const db = recordingDb();
    asToken(db);
    const broken = new Request("http://localhost/api/positions/1/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ non json",
    }) as never;
    expect((await POST(broken, params)).status).toBe(400);
  });
});

describe("la sessione browser continua a funzionare come prima", () => {
  it("registra il giudizio col suo userId", async () => {
    const db = recordingDb();
    asSession(db, "utente-browser");
    const res = await POST(request({ action: "dislike" }), params);
    expect(res.status).toBe(200);
    expect(db.inserted[0]).toMatchObject({
      user_id: "utente-browser",
      action: "dislike",
    });
  });

  it("un attore non autenticato resta fuori", async () => {
    teamAuth.resolveUser.mockResolvedValue({
      ok: false,
      res: Response.json({ error: "Non autenticato" }, { status: 401 }),
    });
    const res = await POST(request({ action: "like" }), params);
    expect(res.status).toBe(401);
  });
});

describe("l'apertura riguarda SOLO questa POST", () => {
  // Asserzione sul sorgente di proposito: il rischio non è che queste route
  // smettano di funzionare, è che qualcuno tolga il loro guard "per coerenza"
  // con quello appena rimosso qui. Ognuna è una decisione a sé.
  const SESSION_ONLY = [
    "app/api/positions/[legacyId]/user-exclude/route.ts",
    "app/api/positions/[legacyId]/write-request/route.ts",
    "app/api/positions/[legacyId]/ticket/route.ts",
    "app/api/positions/[legacyId]/recheck-request/route.ts",
    "app/api/positions/[legacyId]/geocode-request/route.ts",
    "app/api/positions/[legacyId]/summary/route.ts",
    "app/api/team-directives/route.ts",
    "app/api/team-state/emergency-stop/route.ts",
    "app/api/messages/route.ts",
  ];

  it.each(SESSION_ONLY)("%s tiene ancora fuori i token", (relative) => {
    const source = fs.readFileSync(path.join(WEB, relative), "utf8");
    expect(source).toContain('source !== "session"');
  });

  it("la route del feedback spiega perché il suo guard non c'è più", () => {
    // Un 403 sparito senza spiegazione, fra sei mesi, si legge come una
    // svista. La ragione deve stare nel file, non solo nel log di git.
    const source = fs.readFileSync(
      path.join(WEB, "app/api/positions/[legacyId]/feedback/route.ts"),
      "utf8",
    );
    expect(source).not.toContain('source !== "session"');
    expect(source).toContain("OPERATORE");
    expect(source).toContain("service_role");
  });
});
