/**
 * Test sui sorgenti — il web non è l'autorità sullo schema SQLite (#157)
 *
 * `web/lib/db.ts` è per contratto in sola lettura: `getDb()` apre
 * `{ readonly: true }` e da #154 lancia esplicitamente su deploy cloud. Dentro
 * lo stesso file viveva però `initDb()`, l'unica funzione che apriva il DB in
 * SCRITTURA ed eseguiva ~180 righe di DDL — e l'unica che nessuno chiamava.
 *
 * Il difetto non è il codice morto, è la DIVERGENZA SILENZIOSA. Lo schema che
 * quella funzione avrebbe eseguito stampava `PRAGMA user_version = 5` mentre
 * la sorgente di verità (`shared/skills/_db.py`) è alla 7: eseguito su un
 * `jobs.db` vero avrebbe timbrato la versione 5 su un database che quello
 * schema non l'ha mai visto. Nessun test lo copriva, quindi la distanza fra le
 * copie non aveva modo di farsi notare: cresceva e basta.
 *
 * Qui si asserisce sui sorgenti perché è l'unico posto dove il difetto è
 * visibile: una seconda copia dello schema passa typecheck, passa i test
 * funzionali e non rompe niente — finché qualcuno non la esegue.
 *
 * ⚠️ Confine dichiarato, e non è un'omissione. `web/` crea legittimamente
 * QUALCHE tabella: `team-directives-local.ts` e la route della nota privata
 * fanno `CREATE TABLE IF NOT EXISTS` sulle tabelle in cui scrivono loro, hanno
 * chiamanti veri e test propri. La regola che si sorveglia qui è più stretta e
 * mira alla forma che ha prodotto il ticket: nessuno in `web/` ricrea le
 * tabelle del NUCLEO della pipeline (quelle che il container popola) e nessuno
 * timbra `PRAGMA user_version`, che è la firma di «sono io a decidere com'è
 * fatto tutto il database».
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const REPO = join(__dirname, "../../..");
const WEB = join(REPO, "web");

/** Le tabelle che il container possiede e popola: il loro DDL in `web/` è per
 * definizione una seconda copia di uno schema di cui il web non è l'autorità.
 * Restano fuori di proposito le tabelle delle corsie local-first del sito
 * (`team_directives`, `position_user_notes`, …), che il web crea perché ci
 * scrive lui e che hanno già i loro test. */
const CORE_TABLES = [
  "companies",
  "positions",
  "position_highlights",
  "scores",
  "applications",
];

const SKIP = new Set([
  "node_modules",
  ".next",
  "public",
  "out",
  "coverage",
  ".turbo",
]);

/** I commenti escono dal perimetro prima del confronto: la regola vieta il
 * DDL, non la frase che spiega perché non c'è più. Un guard che rende
 * impronunciabile il nome di ciò che sorveglia costringe a documentare il
 * difetto altrove — cioè da nessuna parte. Il prezzo dichiarato: viene tolto
 * anche ciò che segue un `//` dentro una stringa (un URL), che nel materiale
 * che qui si cerca — blob DDL su più righe — non nasconde niente. */
function stripComments(body: string): string {
  return body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sources(full, found);
    else if (/\.(ts|tsx|js|mjs)$/.test(entry)) found.push(full);
  }
  return found;
}

/** Scansione UNA volta sola, in collection: leggere l'albero di `web/` costa
 * secondi, e pagarlo dentro il singolo test lo fa cadere per contesa di disco
 * invece che per il difetto — la lezione di [TWO-FLAKY-TESTS-ARE-NORMALISING-RED].
 * `.js`/`.mjs` sono nella scansione di proposito: la seconda copia dello schema
 * viveva in uno script `.js`, cioè fuori dal perimetro che si guarda di solito. */
const WEB_SOURCES: { path: string; body: string }[] = sources(WEB).map(
  (path) => ({ path, body: stripComments(readFileSync(path, "utf-8")) }),
);

function offenders(pattern: RegExp): string[] {
  return WEB_SOURCES.filter(({ body }) => pattern.test(body))
    .map(({ path }) => relative(REPO, path))
    .sort();
}

describe("web/ non porta una copia dello schema del container", () => {
  it("la scansione vede davvero i sorgenti del web", () => {
    // Senza questa, un `SKIP` sbagliato renderebbe verdi tutte le asserzioni
    // qui sotto su un insieme vuoto.
    expect(WEB_SOURCES.length).toBeGreaterThan(100);
  });

  it("nessun file timbra `PRAGMA user_version`", () => {
    // Il timbro dichiara di conoscere lo schema INTERO. Chi lo scrive senza
    // esserne l'autore data un database che non ha creato: è il modo in cui
    // una copia ferma alla 5 mente su un DB alla 7.
    expect(offenders(/PRAGMA\s+user_version\s*=/i)).toEqual([]);
  });

  it.each(CORE_TABLES)("nessun file crea la tabella `%s`", (table) => {
    expect(
      offenders(new RegExp(`CREATE\\s+TABLE\\s+(IF\\s+NOT\\s+EXISTS\\s+)?${table}\\b`, "i")),
    ).toEqual([]);
  });
});

describe("web/lib/db.ts resta una porta di sola lettura", () => {
  const DB = join(WEB, "lib/db.ts");
  const body = () => stripComments(readFileSync(DB, "utf-8"));

  it("non espone una funzione che inizializza il database", () => {
    // Il web non crea il DB: lo crea il container. Un `initDb` che torna
    // riaprirebbe insieme la scrittura e la seconda copia dello schema.
    expect(body()).not.toContain("initDb");
  });

  it("ogni apertura del database è readonly", () => {
    const opens = body().match(/new Database\([^;]*?\)/g) ?? [];
    expect(opens.length).toBeGreaterThan(0);
    expect(opens.filter((open) => !open.includes("readonly: true"))).toEqual([]);
  });
});
