import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const requireFromWeb = createRequire(
  join(__dirname, "../../../web/package.json"),
);
const Database = requireFromWeb("better-sqlite3");

/**
 * O-102 / #187 — l'esito di una candidatura inviata.
 *
 * In produzione `applications.response` era NULL su tutte e 428 le righe,
 * mentre 8 posizioni erano già passate per lo stato `response`: sapevamo otto
 * volte CHE una risposta era arrivata e nessuna volta COSA dicesse, perché le
 * due metà del fatto le scriveva chi capitava, separatamente.
 *
 * Qui gira il SQL vero, come in `mark-applied-undo`: `local-first-write` è
 * sostituito da una versione che apre un SQLite di prova e chiama il callback
 * `local` della route. Non si testano i cookie — si testa cosa resta scritto
 * nel database, che è la parte che il team legge.
 */
let db: InstanceType<typeof Database>;

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn(async () => null) }));
vi.mock("@/lib/demo/data", () => ({ isDemoLegacyId: vi.fn(() => false) }));
vi.mock("@/lib/demo/mode", () => ({
  activeDemoPersona: vi.fn(async () => null),
}));
vi.mock("@/lib/positions/local-first-write", () => ({
  localFirstWrite: vi.fn(async (_req: unknown, opts: any) => {
    const step = opts.local(db);
    if (!step.ok) {
      return Response.json(step.body, { status: step.status });
    }
    return Response.json({ ...step.outcome, source: "local" });
  }),
}));

const { POST, DELETE } =
  await import("@/app/api/positions/[legacyId]/outcome/route");

function post(outcome: unknown, legacyId = 1) {
  return POST(
    new Request("http://localhost/x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outcome }),
    }) as any,
    { params: Promise.resolve({ legacyId: String(legacyId) }) },
  );
}

function del(legacyId = 1) {
  return DELETE(
    new Request("http://localhost/x", { method: "DELETE" }) as any,
    { params: Promise.resolve({ legacyId: String(legacyId) }) },
  );
}

function seed(opts: {
  positionStatus?: string;
  applied?: boolean;
  response?: string | null;
  interviewRound?: number | null;
}) {
  db.exec(
    "DELETE FROM positions; DELETE FROM applications; DELETE FROM position_state_transitions;",
  );
  db.prepare(
    "INSERT INTO positions (id, title, company, status) VALUES (1, 't', 'c', ?)",
  ).run(opts.positionStatus ?? "applied");
  db.prepare(
    `INSERT INTO applications
       (position_id, status, applied, applied_at, applied_via, response, interview_round)
     VALUES (1, ?, ?, '2026-08-10T10:00:00Z', 'user_manual', ?, ?)`,
  ).run(
    opts.response ? "response" : "applied",
    opts.applied === false ? 0 : 1,
    opts.response ?? null,
    opts.interviewRound ?? null,
  );
}

function state() {
  return {
    application: db
      .prepare(
        "SELECT status, response, response_at, interview_round FROM applications WHERE position_id = 1",
      )
      .get() as Record<string, unknown>,
    position: db
      .prepare("SELECT status, last_actor FROM positions WHERE id = 1")
      .get() as Record<string, unknown>,
    transitions: db
      .prepare(
        "SELECT from_state, to_state, by_agent, notes FROM position_state_transitions ORDER BY id",
      )
      .all() as Array<Record<string, unknown>>,
  };
}

beforeEach(() => {
  const home = mkdtempSync(join(tmpdir(), "jht-outcome-"));
  db = new Database(join(home, "t.db"));
  db.exec(`
    CREATE TABLE positions (id INTEGER PRIMARY KEY, title TEXT, company TEXT,
      status TEXT, last_actor TEXT);
    CREATE TABLE applications (position_id INTEGER PRIMARY KEY, status TEXT,
      applied INTEGER, applied_at TEXT, applied_via TEXT, response TEXT,
      response_at TEXT, interview_round INTEGER,
      -- O-105: lo schema d'ombra segue quello vero. La corsia sa funzionare
      -- anche senza queste due (un jobs.db precedente non le ha), e quel caso
      -- ha il suo test in rejection-reason-round-trip: qui si misura lo
      -- schema attuale, non la compatibilita'.
      rejection_reason TEXT, rejection_note TEXT, updated_at TEXT);
    CREATE TABLE position_state_transitions (id INTEGER PRIMARY KEY AUTOINCREMENT,
      position_id INTEGER, from_state TEXT, to_state TEXT, by_agent TEXT, notes TEXT);
  `);
});

describe("POST /positions/[legacyId]/outcome", () => {
  it("scrive esito, stato e transizione nella stessa mossa", async () => {
    seed({});
    const res = await post("rejected");
    expect(res.status).toBe(200);

    const after = state();
    expect(after.application).toMatchObject({
      status: "response",
      response: "rejected",
    });
    expect(after.application.response_at).toBeTruthy();
    // La metà che prima restava indietro: senza, il team continua a vedere
    // una posizione "inviata" e nient'altro.
    expect(after.position).toMatchObject({
      status: "response",
      last_actor: "user",
    });
    expect(after.transitions).toEqual([
      {
        from_state: "applied",
        to_state: "response",
        by_agent: "user",
        notes: "rejected",
      },
    ]);
  });

  it("il primo colloquio è il round 1", async () => {
    seed({});
    await post("interview");
    expect(state().application.interview_round).toBe(1);
  });

  it("non sovrascrive un round successivo scritto dal team", async () => {
    seed({ interviewRound: 3 });
    await post("interview");
    expect(state().application.interview_round).toBe(3);
  });

  it("rifiuta `ghosted`: è derivato dal silenzio, non dichiarato", async () => {
    seed({});
    const res = await post("ghosted");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_outcome" });

    const after = state();
    expect(after.application.response).toBeNull();
    expect(after.position.status).toBe("applied");
  });

  it("rifiuta un esito fuori vocabolario senza scrivere niente", async () => {
    seed({});
    const res = await post("offerta_verbale");
    expect(res.status).toBe(400);
    expect(state().application.response).toBeNull();
  });

  it("rifiuta un esito su una candidatura mai inviata", async () => {
    seed({ applied: false, positionStatus: "ready" });
    const res = await post("rejected");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "not_applied" });

    const after = state();
    expect(after.application.response).toBeNull();
    expect(after.position.status).toBe("ready");
    expect(after.transitions).toEqual([]);
  });
});

describe("DELETE /positions/[legacyId]/outcome", () => {
  it("torna a `applied`, non più indietro: la candidatura è partita davvero", async () => {
    seed({ positionStatus: "response", response: "rejected" });
    const res = await del();
    expect(res.status).toBe(200);

    const after = state();
    expect(after.application).toMatchObject({
      status: "applied",
      response: null,
      response_at: null,
    });
    expect(after.position.status).toBe("applied");
    expect(after.transitions).toEqual([
      {
        from_state: "response",
        to_state: "applied",
        by_agent: "user",
        notes: "esito annullato dall'utente",
      },
    ]);
  });

  it("azzera il round che ha messo il bottone", async () => {
    seed({
      positionStatus: "response",
      response: "interview",
      interviewRound: 1,
    });
    await del();
    expect(state().application.interview_round).toBeNull();
  });

  it("lascia stare un round che il bottone non ha mai scritto", async () => {
    seed({
      positionStatus: "response",
      response: "interview",
      interviewRound: 2,
    });
    await del();
    expect(state().application.interview_round).toBe(2);
  });

  it("rifiuta l'annullamento quando non c'è nessun esito", async () => {
    seed({});
    const res = await del();
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "no_outcome" });
    expect(state().position.status).toBe("applied");
  });
});
