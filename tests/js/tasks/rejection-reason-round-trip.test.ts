/**
 * O-105 — il motivo deve fare il GIRO, non solo esistere.
 *
 * Criterio di accettazione posto da MASTER, e non è una formalità: una colonna
 * che si ferma sul cloud è muta esattamente come lo era `response` fino al
 * 17/08. Quel giorno #187 aggiunse `response`/`response_at` a UNA delle due
 * select che leggono la stessa corsia, e l'esito dichiarato sul sito non
 * scendeva mai — senza nessun errore, perché la metà che protegge il box
 * funzionava su entrambi i percorsi e solo quella che porta a casa il dato era
 * monca.
 *
 * Da quel difetto è uscito il censimento: i posti che portano le colonne
 * dell'esito fra box e cloud sono CINQUE. Questo test li nomina tutti e
 * cinque, perché una colonna nuova che ne salta uno è il difetto di allora
 * ripetuto — e la prova che regge non è «l'ho scritta», è «l'ho ritrovata
 * dall'altra parte».
 *
 *   1. la route Vercel  `pull-desired-state`      (cloud → box)
 *   2. il lettore diretto `supabase-direct.js`    (cloud → box)
 *   3. l'applicazione al box `applied-backflow.js`
 *   4. l'elenco di colonne del push `cloud.js`    (box → cloud)
 *   5. `web/app/api/local/sync`                   (box → cloud, modalità locale)
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

const repo = join(__dirname, "../../..");
const requireFromWeb = createRequire(join(repo, "web/package.json"));
const Database = requireFromWeb("better-sqlite3");

const COLONNE = ["rejection_reason", "rejection_note"] as const;

function sorgente(relativo: string): string {
  return readFileSync(join(repo, relativo), "utf-8");
}

describe("le due colonne attraversano tutte e cinque le tappe", () => {
  it("1 · la route Vercel le chiede al cloud", () => {
    const src = sorgente("web/app/api/cloud-sync/pull-desired-state/route.ts");
    const select = src.match(
      /"(applied,[^"]*positions!inner\(legacy_id\))"/,
    )?.[1];
    expect(
      select,
      "select delle candidature non trovata nella route",
    ).toBeTruthy();
    for (const c of COLONNE) expect(select).toContain(c);
  });

  it("2 · il lettore diretto le chiede al cloud", () => {
    const src = sorgente("cli/src/lib/supabase-direct.js");
    const select = src.match(
      /'(applied,[^']*positions!inner\(legacy_id\))'/,
    )?.[1];
    expect(
      select,
      "select delle candidature non trovata nel lettore diretto",
    ).toBeTruthy();
    for (const c of COLONNE) expect(select).toContain(c);
  });

  it("4 · il push del box le manda al cloud", () => {
    const src = sorgente("cli/src/commands/cloud.js");
    // Si guarda il BLOCCO che costruisce l'elenco, non il solo letterale: le
    // colonne aggiunte dopo lo schema di partenza entrano con una guardia
    // `sqliteHasColumn` — un box non ancora passato da `ensure_schema` deve
    // pushare il resto invece di far cadere il daemon. Restringere il test al
    // letterale mi ha fatto scrivere codice storto per farlo passare, che è il
    // modo in cui un test sbagliato peggiora il codice invece di proteggerlo.
    const blocco = src.match(
      /const applicationCols = \[[\s\S]*?readSqliteTableDelta\(db, 'applications'/,
    )?.[0];
    expect(
      blocco,
      "costruzione delle colonne del push non trovata",
    ).toBeTruthy();
    for (const c of COLONNE) expect(blocco).toContain(c);
  });

  it("5 · la sincronizzazione locale le manda al cloud", () => {
    const src = sorgente("web/app/api/local/sync/route.ts");
    for (const c of COLONNE) expect(src).toContain(`${c}: a.${c}`);
  });
});

describe("3 · il box scrive il motivo che arriva dal cloud", () => {
  const SCHEMA = `
    CREATE TABLE positions (
      id INTEGER PRIMARY KEY, title TEXT, company TEXT,
      status TEXT, last_actor TEXT
    );
    CREATE TABLE applications (
      id INTEGER PRIMARY KEY, position_id INTEGER UNIQUE,
      status TEXT DEFAULT 'draft', applied INTEGER DEFAULT 0,
      applied_at TEXT, applied_via TEXT, response TEXT, response_at TEXT,
      rejection_reason TEXT, rejection_note TEXT,
      interview_round INTEGER, cv_path TEXT, cv_pdf_path TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE scores (position_id INTEGER UNIQUE, total_score INTEGER);
    CREATE TABLE position_state_transitions (
      id INTEGER PRIMARY KEY, position_id INTEGER,
      from_state TEXT, to_state TEXT, by_agent TEXT, notes TEXT
    );
  `;

  function box() {
    const home = mkdtempSync(join(tmpdir(), "jht-rejection-"));
    const db = new Database(join(home, "jobs.db"));
    db.exec(SCHEMA);
    db.prepare(
      "INSERT INTO positions (id, title, company, status) VALUES (5, 'Ruolo', 'Azienda', 'applied')",
    ).run();
    db.prepare(
      `INSERT INTO applications (position_id, status, applied, applied_at, applied_via)
       VALUES (5, 'applied', 1, '2026-08-17T09:00:00.000Z', 'user_manual')`,
    ).run();
    return db;
  }

  function riga(extra: Record<string, unknown>) {
    return {
      legacy_id: 5,
      applied: true,
      applied_at: "2026-08-17T09:00:00.000Z",
      applied_via: "user_manual",
      status: "response",
      response: "rejected",
      response_at: "2026-08-17T18:00:00.000Z",
      updated_at: "2026-08-17T18:00:00.000Z",
      ...extra,
    };
  }

  function esito(db: any) {
    return db
      .prepare(
        "SELECT response, rejection_reason, rejection_note FROM applications WHERE position_id = 5",
      )
      .get();
  }

  it("porta a casa motivo e testo insieme", async () => {
    const { applyAppliedBackflow } =
      await import("../../../cli/src/lib/applied-backflow.js");
    const db = box();

    applyAppliedBackflow(db, [
      riga({
        rejection_reason: "salary",
        rejection_note: "sotto del 30% rispetto al mio",
      }),
    ]);

    expect(esito(db)).toEqual({
      response: "rejected",
      rejection_reason: "salary",
      rejection_note: "sotto del 30% rispetto al mio",
    });
  });

  it("porta a casa il solo testo, quando nessun motivo copre il caso", async () => {
    const { applyAppliedBackflow } =
      await import("../../../cli/src/lib/applied-backflow.js");
    const db = box();

    // «hanno preso un altro» non è fra i quattro predefiniti: se il testo si
    // perdesse per strada, l'unica cosa che quel rifiuto ci insegna sarebbe
    // proprio quella che non arriva.
    applyAppliedBackflow(db, [
      riga({ rejection_note: "hanno preso un altro candidato" }),
    ]);

    expect(esito(db)).toEqual({
      response: "rejected",
      rejection_reason: null,
      rejection_note: "hanno preso un altro candidato",
    });
  });

  // IL CASO CHE RIPETE IL DIFETTO DI IERI UN PIANO PIÙ SU.
  //
  // L'utente dichiara «rifiutata» oggi e aggiunge il perché dopo — che è la
  // sequenza normale, non un caso limite: il bottone è un clic, la spiegazione
  // richiede di pensarci. Al pull successivo l'esito è IDENTICO, quindi la
  // decisione risponde `already_recorded` e salta. Il motivo non scenderebbe
  // MAI, senza nessun errore: esattamente come `response` non scendeva quando
  // la corsia chiedeva «è partita?» invece di «il box è già avanti quanto il
  // cloud?».
  it("il motivo che arriva DOPO l'esito scende lo stesso", async () => {
    const { applyAppliedBackflow } =
      await import("../../../cli/src/lib/applied-backflow.js");
    const db = box();

    // Primo giro: solo il rifiuto.
    applyAppliedBackflow(db, [riga({})]);
    expect(esito(db)).toMatchObject({ rejection_reason: null });

    // Secondo giro: stesso esito, stesso istante, ma adesso c'è il perché.
    applyAppliedBackflow(db, [
      riga({
        rejection_reason: "experience",
        rejection_note: "volevano 8 anni",
      }),
    ]);

    expect(esito(db)).toEqual({
      response: "rejected",
      rejection_reason: "experience",
      rejection_note: "volevano 8 anni",
    });
  });

  it("ma un motivo che il box ha già non viene cancellato da un pull muto", async () => {
    // La clausola falsa. Se per far scendere il motivo bastasse «il cloud dice
    // qualcosa di diverso», un pull che arriva senza motivo cancellerebbe
    // quello che il team ha scritto dalla CLI. È il difetto di ieri col segno
    // invertito, e la regola è la stessa: a parità di dubbio non si scrive.
    const { applyAppliedBackflow } =
      await import("../../../cli/src/lib/applied-backflow.js");
    const db = box();
    applyAppliedBackflow(db, [
      riga({
        rejection_reason: "language",
        rejection_note: "serviva il tedesco",
      }),
    ]);

    applyAppliedBackflow(db, [riga({})]);

    expect(esito(db)).toEqual({
      response: "rejected",
      rejection_reason: "language",
      rejection_note: "serviva il tedesco",
    });
  });

  it("un box che le colonne non le ha ancora riceve comunque l'esito", async () => {
    // Un `jobs.db` creato da un'immagine precedente non ha le due colonne
    // finché `ensure_schema` non gira. Se la corsia le nominasse comunque, la
    // SELECT fallirebbe e cadrebbe TUTTO — candidature comprese — dentro il
    // `catch` che stampa un warning e prosegue: un box vecchio smetterebbe di
    // ricevere le candidature dal sito per via di una colonna che non usa.
    //
    // Il caso è coperto anche da `cloud-outcome-backflow.test.ts`, il cui
    // schema d'ombra è nato prima di O-105 — ma per caso, e chi lo allargasse
    // domani porterebbe via la copertura senza accorgersene. Qui è voluto.
    const { applyAppliedBackflow } =
      await import("../../../cli/src/lib/applied-backflow.js");
    const home = mkdtempSync(join(tmpdir(), "jht-rejection-vecchio-"));
    const db = new Database(join(home, "jobs.db"));
    db.exec(SCHEMA.replace("rejection_reason TEXT, rejection_note TEXT,", ""));
    db.prepare(
      "INSERT INTO positions (id, title, company, status) VALUES (5, 'Ruolo', 'Azienda', 'applied')",
    ).run();
    db.prepare(
      `INSERT INTO applications (position_id, status, applied, applied_at, applied_via)
       VALUES (5, 'applied', 1, '2026-08-17T09:00:00.000Z', 'user_manual')`,
    ).run();

    const res = applyAppliedBackflow(db, [
      riga({ rejection_reason: "salary", rejection_note: "troppo bassa" }),
    ]);

    expect(res.outcomes).toBe(1);
    expect(
      db
        .prepare("SELECT response FROM applications WHERE position_id = 5")
        .get(),
    ).toEqual({ response: "rejected" });
  });

  it("un rifiuto senza perché resta un rifiuto", async () => {
    const { applyAppliedBackflow } =
      await import("../../../cli/src/lib/applied-backflow.js");
    const db = box();

    applyAppliedBackflow(db, [riga({})]);

    expect(esito(db)).toEqual({
      response: "rejected",
      rejection_reason: null,
      rejection_note: null,
    });
  });
});
