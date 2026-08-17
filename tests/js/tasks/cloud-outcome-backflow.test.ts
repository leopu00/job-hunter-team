// #186 × #187 — l'esito di una candidatura deve sopravvivere a un pull.
//
// Nessuno dei due ticket è sbagliato preso da solo. #186 riporta a casa la
// CANDIDATURA e scrive `status='applied'` perché il suo mondo finiva lì; #187
// ha introdotto uno stato che quel mondo non conosceva — `response`, la
// progressione post-invio. Messi insieme, la corsia di ritorno guarda una riga
// che il box ha già portato più avanti e la riporta indietro.
//
// La guardia ESISTEVA: il commento in `applied-action.js` dice «se nel
// frattempo è arrivata una risposta dell'azienda quel cambio è più recente e
// non lo si calpesta» — ma stava su UN ramo su due, quello dell'annullamento.
// Una difesa scritta a metà è peggio di una assente, perché il commento
// convince chi legge che il caso è coperto.
//
// Questi test provano due versi:
//   1. l'esito registrato sul box non viene riportato indietro da un pull;
//   2. l'esito dichiarato sul sito ARRIVA al box — che è il motivo per cui la
//      corsia esiste: il Mentor conta `applications.response`, e un campo che
//      non scende non lo conta nessuno.
import { beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const repo = join(__dirname, "../../..");
const requireFromWeb = createRequire(join(repo, "web/package.json"));
const Database = requireFromWeb("better-sqlite3");

const APPLIED_VIA_USER = "user_manual";

// Stessa ombra di schema di cloud-applied-backflow, più le colonne dell'esito.
const SCHEMA = `
  CREATE TABLE positions (
    id INTEGER PRIMARY KEY, title TEXT, company TEXT,
    status TEXT, last_actor TEXT
  );
  CREATE TABLE applications (
    id INTEGER PRIMARY KEY, position_id INTEGER UNIQUE,
    status TEXT DEFAULT 'draft', applied INTEGER DEFAULT 0,
    applied_at TEXT, applied_via TEXT, response TEXT, response_at TEXT,
    interview_round INTEGER, cv_path TEXT, cv_pdf_path TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE scores (position_id INTEGER UNIQUE, total_score INTEGER);
  CREATE TABLE position_state_transitions (
    id INTEGER PRIMARY KEY, position_id INTEGER,
    from_state TEXT, to_state TEXT, by_agent TEXT, notes TEXT
  );
`;

type Db = {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...args: unknown[]): { changes: number };
    get(...args: unknown[]): Record<string, unknown> | undefined;
    all(...args: unknown[]): Record<string, unknown>[];
  };
  close(): void;
};

const home = mkdtempSync(join(tmpdir(), "jht-outcome-backflow-"));
let db: Db;
let dbSeq = 0;

beforeEach(() => {
  db = new Database(join(home, `jobs-${dbSeq++}.db`)) as Db;
  db.exec(SCHEMA);
});

/** Una candidatura mandata dall'utente dal sito e già tornata a casa. */
function seedApplied(id: number) {
  db.prepare(
    "INSERT INTO positions (id, title, company, status) VALUES (?, 'Ruolo', 'Azienda', 'applied')",
  ).run(id);
  db.prepare(
    `INSERT INTO applications (position_id, status, applied, applied_at, applied_via)
     VALUES (?, 'applied', 1, '2026-08-17T09:00:00.000Z', ?)`,
  ).run(id, APPLIED_VIA_USER);
}

/** …e poi l'azienda ha risposto: l'esito è registrato SUL BOX. */
function seedOutcome(id: number, response = "rejected") {
  seedApplied(id);
  db.prepare(
    `UPDATE applications
        SET status = 'response', response = ?, response_at = '2026-08-17T18:00:00.000Z'
      WHERE position_id = ?`,
  ).run(response, id);
  db.prepare("UPDATE positions SET status = 'response' WHERE id = ?").run(id);
}

/** La riga che il pull consegna: per il cloud la candidatura è inviata. */
function cloudRow(legacyId: number, extra: Record<string, unknown> = {}) {
  return {
    legacy_id: legacyId,
    applied: true,
    applied_at: "2026-08-17T09:00:00.000Z",
    applied_via: APPLIED_VIA_USER,
    status: "applied",
    updated_at: "2026-08-17T18:00:00.000Z",
    ...extra,
  };
}

function state(id: number) {
  return {
    application: db
      .prepare(
        "SELECT status, applied, response, response_at, interview_round FROM applications WHERE position_id = ?",
      )
      .get(id) as Record<string, unknown>,
    position: db
      .prepare("SELECT status FROM positions WHERE id = ?")
      .get(id) as Record<string, unknown>,
    transitions: db
      .prepare(
        "SELECT from_state, to_state, notes FROM position_state_transitions WHERE position_id = ? ORDER BY id",
      )
      .all(id) as Array<Record<string, unknown>>,
  };
}

describe("l'esito registrato sul box sopravvive alla corsia di ritorno", () => {
  it("un pull che dice solo «inviata» non riporta indietro un esito già arrivato", async () => {
    const { applyAppliedBackflow } =
      await import("../../../cli/src/lib/applied-backflow.js");
    seedOutcome(7);

    const res = applyAppliedBackflow(db, [cloudRow(7)]);

    const after = state(7);
    // Il fatto che conta: lo stato non torna indietro. Prima della correzione
    // il verdetto cadeva su `apply` — lo skip pretendeva status === 'applied'
    // e qui lo stato è 'response' — e la corsia riscriveva 'applied'.
    expect(after.position.status).toBe("response");
    expect(after.application.status).toBe("response");
    expect(after.application.response).toBe("rejected");
    // E nessun evento inventato: una transizione verso 'applied' racconterebbe
    // al team una candidatura appena registrata che è di ieri.
    expect(after.transitions).toEqual([]);
    expect(res.applied).toBe(0);
    expect(res.skipped).toBe(1);
  });

  it("la corsia resta idempotente: due giri di fila non cambiano niente", async () => {
    const { applyAppliedBackflow } =
      await import("../../../cli/src/lib/applied-backflow.js");
    seedOutcome(8, "interview");
    applyAppliedBackflow(db, [cloudRow(8)]);
    applyAppliedBackflow(db, [cloudRow(8)]);

    const after = state(8);
    expect(after.position.status).toBe("response");
    expect(after.application.response).toBe("interview");
    expect(after.transitions).toEqual([]);
  });
});

describe("l'esito dichiarato sul sito arriva al box", () => {
  it("porta a casa la risposta e il suo istante", async () => {
    const { applyAppliedBackflow } =
      await import("../../../cli/src/lib/applied-backflow.js");
    seedApplied(9);

    applyAppliedBackflow(db, [
      cloudRow(9, {
        status: "response",
        response: "interview",
        response_at: "2026-08-17T18:30:00.000Z",
      }),
    ]);

    const after = state(9);
    // Senza queste colonne il box sa CHE hanno risposto e non COSA hanno
    // risposto: è la riga muta che #187 ha appena finito di chiudere, ricreata
    // un piano più sopra.
    expect(after.application.response).toBe("interview");
    expect(after.application.response_at).toBe("2026-08-17T18:30:00.000Z");
    expect(after.application.status).toBe("response");
    expect(after.position.status).toBe("response");
    expect(after.transitions).toEqual([
      {
        from_state: "applied",
        to_state: "response",
        notes: "esito registrato dall'utente sul web",
      },
    ]);
  });

  it("un esito già identico non riscrive niente", async () => {
    const { applyAppliedBackflow } =
      await import("../../../cli/src/lib/applied-backflow.js");
    seedOutcome(10, "rejected");

    applyAppliedBackflow(db, [
      cloudRow(10, {
        status: "response",
        response: "rejected",
        response_at: "2026-08-17T18:00:00.000Z",
      }),
    ]);

    expect(state(10).transitions).toEqual([]);
  });

  it("un esito che cambia idea (respinta → colloquio) arriva anche se il box ne ha già uno", async () => {
    const { applyAppliedBackflow } =
      await import("../../../cli/src/lib/applied-backflow.js");
    seedOutcome(11, "rejected");

    applyAppliedBackflow(db, [
      cloudRow(11, {
        status: "response",
        response: "interview",
        response_at: "2026-08-17T19:00:00.000Z",
      }),
    ]);

    const after = state(11);
    expect(after.application.response).toBe("interview");
  });

  // IL CASO VERO — posizione 1362, valori presi dal prima/dopo misurato da
  // @vps il 17/08 (box contro cloud), non inventati.
  //
  // La forma del difetto, con le parole di chi l'ha misurato: «il backflow
  // scrive applied/NULL sopra una riga il cui esito esiste solo sul cloud, e
  // lo fa SENZA GUARDARE se il cloud è più avanti. Qui il locale ha vinto pur
  // avendo updated_at più vecchio di nove minuti.»
  //
  // Sta scritto qui perché impedisce di ripararlo male: non bastava aggiungere
  // `response` alla select e all'upsert — serviva che la corsia CONFRONTASSE.
  //
  // I timestamp sono quelli veri, nei formati veri: il cloud manda
  // `+00:00`, il box scrive `YYYY-MM-DD HH:MM:SS` senza fuso. Un confronto
  // fra stringhe direbbe sempre che il cloud è più recente.
  it("posizione 1362: il box dice applied/NULL, il cloud sa che è rejected", async () => {
    const { applyAppliedBackflow } =
      await import("../../../cli/src/lib/applied-backflow.js");
    // BOX PRIMA: quello che ci aveva scritto il pull delle 15:54:39 — nove
    // minuti PRIMA del click dell'operatore.
    db.prepare(
      "INSERT INTO positions (id, title, company, status) VALUES (1362, 'Ruolo', 'Azienda', 'applied')",
    ).run();
    db.prepare(
      `INSERT INTO applications
         (position_id, status, applied, applied_at, applied_via, response, response_at, updated_at)
       VALUES (1362, 'applied', 1, '2026-08-16 17:06:38.517+00', ?, NULL, NULL, '2026-08-17 15:54:39')`,
    ).run(APPLIED_VIA_USER);

    // CLOUD: la verità, scritta dal click delle 16:03:34.
    applyAppliedBackflow(db, [
      {
        legacy_id: 1362,
        applied: true,
        applied_at: "2026-08-16T17:06:38.517+00:00",
        applied_via: APPLIED_VIA_USER,
        status: "response",
        response: "rejected",
        response_at: "2026-08-17T16:03:34.265+00:00",
        updated_at: "2026-08-17T16:03:34.287+00:00",
      },
    ]);

    // BOX DOPO, come l'ha allineato @vps a mano: l'esito c'è, e `applied_at`
    // resta quello vero e non la data di oggi.
    const after = state(1362);
    expect(after.application.response).toBe("rejected");
    expect(after.application.response_at).toBe("2026-08-17T16:03:34.265+00:00");
    expect(after.application.status).toBe("response");
    expect(after.position.status).toBe("response");
    expect(
      (
        db
          .prepare(
            "SELECT applied_at FROM applications WHERE position_id = 1362",
          )
          .get() as { applied_at: string }
      ).applied_at,
    ).toBe("2026-08-16 17:06:38.517+00");
  });

  it("una candidatura che il box non ha resta fuori, come per gli altri campi", async () => {
    const { applyAppliedBackflow } =
      await import("../../../cli/src/lib/applied-backflow.js");
    const res = applyAppliedBackflow(db, [
      cloudRow(99, { status: "response", response: "rejected" }),
    ]);
    expect(res.skipped).toBe(1);
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM applications").get() as {
        n: number;
      },
    ).toEqual({ n: 0 });
  });
});
