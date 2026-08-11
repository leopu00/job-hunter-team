/**
 * Test unitari — la nota privata e la seconda chiave (vitest)
 *
 * O-33 ha cambiato la chiave di `position_user_notes` da `(position_id)` a
 * `(position_id, origin)`, perché quando la stessa nota diverge fra box e sito
 * si tengono ENTRAMBI i testi. Il cambio di chiave non rompe niente a
 * compile-time: rompe a runtime, e in due modi che nessun test funzionale
 * esistente vedeva.
 *
 * 1. `ON CONFLICT(position_id)` su una tabella la cui chiave è composta non è
 *    un upsert che si comporta male, è `OperationalError: ON CONFLICT clause
 *    does not match any PRIMARY KEY or UNIQUE constraint`. Salvare una nota dal
 *    sito lanciava 500. È già successo: il ramo che portava O-33 era marcato
 *    NOT FOR MERGE proprio per questo, ed è finito in master comunque.
 *
 * 2. Una SELECT senza `WHERE origin = ...` torna una riga QUALSIASI fra le due
 *    che la nuova chiave permette — scelta dall'ordine fisico della tabella.
 *    La pagina mostrerebbe la nota dell'altra superficie e il salvataggio
 *    sembrerebbe non aver fatto niente.
 *
 * La semantica SQLite è già provata in Python (tests/test_note_origin_migration
 * .py, tests/test_position_user_notes.py). Quello che nessuno guardava sono i
 * SORGENTI TypeScript, che parlano con la stessa tabella da un altro
 * linguaggio: qui si asserisce su quelli. Un writer nuovo aggiunto senza
 * pensare a `origin` non farebbe fallire nessun test funzionale — scriverebbe
 * soltanto nella riga sbagliata, in silenzio.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const REPO = join(__dirname, "../../..");
const WEB = join(REPO, "web");
const TABLE = "position_user_notes";

const SKIP = new Set([
  "node_modules",
  ".next",
  "public",
  "out",
  "coverage",
  ".turbo",
]);

function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sources(full, found);
    else if (/\.(ts|tsx)$/.test(entry)) found.push(full);
  }
  return found;
}

/** I file del web che toccano la tabella, qualunque siano. Deliberatamente
 * scoperti scandendo l'albero e non elencati a mano: un elenco a mano non si
 * accorge del file aggiunto domani, che è il caso da proteggere. */
function filesTouchingTheTable(): { path: string; body: string }[] {
  return sources(WEB)
    .map((path) => ({ path, body: readFileSync(path, "utf-8") }))
    .filter(({ body }) => body.includes(TABLE));
}

describe("nota privata — nessuno tocca la tabella ignorando `origin`", () => {
  it("trova davvero dei file, altrimenti il test non sta provando niente", () => {
    // Senza questa asserzione un refactor che rinomina la tabella renderebbe
    // tutti i test qui sotto verdi su un insieme vuoto.
    expect(filesTouchingTheTable().length).toBeGreaterThan(0);
  });

  it("ogni file che nomina la tabella nomina anche `origin`", () => {
    const unaware = filesTouchingTheTable()
      .filter(({ body }) => !body.includes("origin"))
      .map(({ path }) => relative(REPO, path));
    expect(unaware).toEqual([]);
  });
});

describe("la route che scrive la nota", () => {
  const ROUTE = join(
    WEB,
    "app/api/positions/[legacyId]/user-note/route.ts",
  );
  const body = () => readFileSync(ROUTE, "utf-8");

  it("non fa nascere la tabella nella forma pre-O-33", () => {
    // `ensureTable` è un CREATE IF NOT EXISTS che gira su un jobs.db qualsiasi:
    // se dichiarasse ancora `position_id INTEGER PRIMARY KEY` la route creerebbe
    // la forma vecchia su un DB nuovo, e la migrazione del box dovrebbe poi
    // ricrearla — con dentro le note di qualcuno.
    const ddl = body();
    expect(ddl).toContain("PRIMARY KEY (position_id, origin)");
    expect(ddl).not.toMatch(/position_id\s+INTEGER\s+PRIMARY\s+KEY/);
  });

  it("l'upsert nella forma nuova dichiara il conflitto sulla chiave completa", () => {
    expect(body()).toContain("ON CONFLICT(position_id, origin)");
  });

  it("guarda com'è fatta la tabella invece di dare per scontata la forma nuova", () => {
    // Fra l'aggiornamento del codice e il primo giro delle migrazioni del box
    // c'è una finestra reale in cui la colonna non esiste ancora: è la finestra
    // in cui O-16 ha già fatto perdere a un utente quello che aveva scritto.
    // Chi scrive deve accorgersene, non presumere.
    expect(body()).toContain("PRAGMA table_info(position_user_notes)");
  });
});

describe("la pagina che legge la nota", () => {
  const QUERIES = join(WEB, "lib/local-queries.ts");
  const body = () => readFileSync(QUERIES, "utf-8");

  it("filtra sulla superficie da cui legge", () => {
    expect(body()).toContain("origin = 'box'");
  });

  it("sa leggere anche un jobs.db non ancora migrato", () => {
    // Il fallback senza filtro non è difensivismo: senza di lui la query
    // filtrata solleverebbe sulla forma vecchia e un `catch` che torna `null`
    // farebbe SPARIRE dalla pagina una nota che c'è.
    const src = body();
    const start = src.indexOf("function readUserNote");
    expect(start).toBeGreaterThan(-1);
    const fn = src.slice(start, src.indexOf("\n}", start));
    expect(fn).toContain("origin = 'box'");
    expect(fn).toMatch(/WHERE position_id = \?"/);
  });
});
