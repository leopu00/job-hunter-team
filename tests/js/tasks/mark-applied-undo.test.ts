import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const requireFromWeb = createRequire(
  join(__dirname, "../../../web/package.json"),
);
const Database = requireFromWeb("better-sqlite3");

/**
 * O-36 — «mi sono candidato» non si annullava.
 *
 * Il bottone era disabilitato dopo il click: un tocco per sbaglio lasciava la
 * posizione 'applied' per sempre e il team smetteva di lavorarci. L'operatore
 * ci è cascato di persona il giorno del rilascio.
 *
 * Qui gira il SQL vero: `local-first-write` è sostituito da una versione che
 * apre un SQLite di prova e chiama il callback `local` della route. Non si
 * testano i cookie — si testa cosa resta scritto nel database, che è la parte
 * che il team legge.
 */
let db: InstanceType<typeof Database>;
let home: string;

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

const { DELETE } =
  await import("@/app/api/positions/[legacyId]/mark-applied/route");

function call(legacyId = 1) {
  return DELETE(
    new Request("http://localhost/x", { method: "DELETE" }) as any,
    {
      params: Promise.resolve({ legacyId: String(legacyId) }),
    },
  );
}

function seed(opts: {
  status: string;
  appliedVia?: string | null;
  transitionFrom?: string | null;
  cvPath?: string | null;
  score?: boolean;
}) {
  db.exec(
    "DELETE FROM positions; DELETE FROM applications; DELETE FROM scores; DELETE FROM position_state_transitions;",
  );
  db.prepare(
    "INSERT INTO positions (id, title, company, status) VALUES (1, 't', 'c', ?)",
  ).run(opts.status);
  db.prepare(
    `INSERT INTO applications (position_id, status, applied, applied_at, applied_via, cv_path)
     VALUES (1, 'applied', 1, '2026-08-10T10:00:00Z', ?, ?)`,
  ).run(opts.appliedVia ?? "user_manual", opts.cvPath ?? null);
  if (opts.transitionFrom)
    db.prepare(
      `INSERT INTO position_state_transitions (position_id, from_state, to_state, by_agent)
       VALUES (1, ?, 'applied', 'user')`,
    ).run(opts.transitionFrom);
  if (opts.score)
    db.prepare(
      "INSERT INTO scores (position_id, total_score) VALUES (1, 80)",
    ).run();
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "jht-undo-"));
  db = new Database(join(home, "t.db"));
  db.exec(`
    CREATE TABLE positions (id INTEGER PRIMARY KEY, title TEXT, company TEXT,
      status TEXT, last_actor TEXT);
    CREATE TABLE applications (position_id INTEGER PRIMARY KEY, status TEXT,
      applied INTEGER, applied_at TEXT, applied_via TEXT, cv_path TEXT,
      cv_pdf_path TEXT, updated_at TEXT);
    CREATE TABLE scores (position_id INTEGER PRIMARY KEY, total_score INTEGER);
    CREATE TABLE position_state_transitions (id INTEGER PRIMARY KEY AUTOINCREMENT,
      position_id INTEGER, from_state TEXT, to_state TEXT, by_agent TEXT, notes TEXT);
  `);
});

describe("annullare la candidatura manuale", () => {
  it("riporta la posizione allo stato REGISTRATO, non a uno inventato", async () => {
    seed({ status: "applied", transitionFrom: "review" });
    const res = await call();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      status: "review",
      public_state: "preparing",
    });
    expect(db.prepare("SELECT status FROM positions WHERE id=1").get()).toEqual(
      {
        status: "review",
      },
    );
  });

  it("cancella i campi della candidatura, non solo lo stato", async () => {
    // Se restasse applied=1 il team leggerebbe due verità sulla stessa riga.
    seed({ status: "applied", transitionFrom: "ready" });
    await call();
    expect(
      db
        .prepare(
          "SELECT applied, applied_at, applied_via, status FROM applications WHERE position_id=1",
        )
        .get(),
    ).toEqual({
      applied: 0,
      applied_at: null,
      applied_via: null,
      status: "draft",
    });
  });

  it("lascia traccia dell'annullamento nel registro delle transizioni", async () => {
    seed({ status: "applied", transitionFrom: "ready" });
    await call();
    const last = db
      .prepare(
        "SELECT from_state, to_state, by_agent FROM position_state_transitions ORDER BY id DESC LIMIT 1",
      )
      .get() as Record<string, string>;
    expect(last).toMatchObject({
      from_state: "applied",
      to_state: "ready",
      by_agent: "user",
    });
  });

  it("rifiuta se nel frattempo lo stato è cambiato", async () => {
    // Es. è arrivata la risposta dell'azienda: annullare qui cancellerebbe
    // un fatto più recente.
    seed({ status: "response", transitionFrom: "ready" });
    const res = await call();
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: "not_applied" });
  });

  it("rifiuta se la candidatura l'ha inviata il team", async () => {
    seed({
      status: "applied",
      appliedVia: "agent_auto",
      transitionFrom: "ready",
    });
    const res = await call();
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: "applied_by_team",
    });
    // E soprattutto: non ha toccato niente.
    expect(db.prepare("SELECT status FROM positions WHERE id=1").get()).toEqual(
      {
        status: "applied",
      },
    );
  });

  it("senza transizione registrata deduce dai fatti: CV pronto → ready", async () => {
    seed({ status: "applied", cvPath: "/cv/1.md" });
    await expect((await call()).json()).resolves.toMatchObject({
      status: "ready",
    });
  });

  it("senza transizione e senza CV, ma con uno score → scored", async () => {
    seed({ status: "applied", score: true });
    await expect((await call()).json()).resolves.toMatchObject({
      status: "scored",
    });
  });

  it("senza niente → new, che è da dove si riparte", async () => {
    seed({ status: "applied" });
    await expect((await call()).json()).resolves.toMatchObject({
      status: "new",
    });
  });
});
