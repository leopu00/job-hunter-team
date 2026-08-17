// [JHT-TEAM-API-BOUNDARY] Censimento STRUTTURALE dello schema di jobs.db.
/**
 * Risponde a una domanda sola: **le tabelle e le colonne che le route di
 * lettura nominano ci sono?** Non «il database è alla versione giusta»: quella
 * è un'altra domanda, e dare la stessa risposta a entrambe è il difetto che
 * questo file esiste per non ripetere.
 *
 * Perché il numero di versione NON decide la disponibilità
 * ------------------------------------------------------
 * `shared/skills/_db.py` timbra `PRAGMA user_version = 7` alla fine di
 * `ensure_schema`, ma il docstring della stessa funzione documenta già una
 * migrazione **v7→v8** (`_db.py:122-127`): il timbro e la storia delle
 * migrazioni sono già in disaccordo nel repo, oggi. Un server che rifiutasse
 * di servire su `user_version != 7` sarebbe quindi rotto **su installazioni
 * sane**, e in più: solo il percorso Python migra, e lo fa come EFFETTO
 * COLLATERALE della lettura (`db_query.py` → `ensure_schema` → `_run_migrations`).
 * Una macchina che ha scaricato un'immagine nuova ma non ha ancora avviato il
 * team è legittimamente indietro di una migrazione, con tutte le colonne che
 * servono già al loro posto.
 *
 * Quindi: **una tabella o una colonna che manca è un 503**
 * (`DB_SCHEMA_INCOMPLETE`), un `userVersion` diverso da quello atteso è
 * **informativo** — finisce in `GET /version`, viene loggato una volta
 * all'avvio, e non nega mai una risposta.
 *
 * Perché l'elenco è CORTO e volutamente non copre tutto
 * ----------------------------------------------------
 * Qui stanno le colonne che il nucleo delle route legge per nome. Il dettaglio
 * di una posizione (`POSITION_DETAIL_SELECT`) ne nomina molte altre
 * (`s.breakdown`, `a.applied_via`, `c.sector`, …) e NON sono nel censimento di
 * proposito: mettercele significherebbe spegnere con un 503 l'intera API
 * perché manca una colonna che serve a una route sola. Quel caso è gestito
 * dove nasce — `readonly-sqlite.js` traduce il «no such column» del driver in
 * `DB_SCHEMA_INCOMPLETE` per la singola richiesta, non per tutte.
 *
 * Zero dipendenze e nessuna interpolazione di SQL: la connessione è iniettata,
 * i nomi di tabella arrivano SOLO dalle costanti qui sotto e passano comunque
 * come parametro legato a `pragma_table_info(?)`. Niente stringhe costruite a
 * mano attorno a un nome che un giorno potrebbe arrivare da una richiesta.
 */

// [JHT-TEAM-API-BOUNDARY] Il numero di versione atteso, e il suo guardiano.
//
// Vale `7` perché è quello che `_db.py:849` timbra. Non è una regola: è una
// COPIA, e come ogni copia deriva. Per questo il valore è legato al file
// Python da un test di drift (`tests/js/tasks/api-read-sql-drift.test.ts`), che
// estrae `PRAGMA user_version = (\d+)` da `_db.py` e pretende lo stesso numero.
// Chi alza il timbro là fa cadere il test qui, e decide con gli occhi aperti.
export const EXPECTED_USER_VERSION = 7;

// [JHT-TEAM-API-BOUNDARY] Le tabelle e le colonne che le route nominano.
//
// L'ordine delle chiavi è quello del piano del ticket, non alfabetico: così
// `missing` esce sempre nello stesso ordine e due `GET /version` presi a
// distanza di un'ora si possono confrontare a occhio. Le colonne sono quelle
// che compaiono per NOME nell'SQL portato da `db_query.py`:
//
//   positions      p.id, p.status, p.company, p.source, p.found_at,
//                  p.company_id, p.title
//   scores         s.position_id, s.total_score
//   applications   a.position_id, a.status, a.critic_verdict, a.applied_at,
//                  a.written_at, a.id
//   companies      c.id, c.hq_country, c.verdict
//
// `positions.*` non è nell'elenco perché `SELECT p.*` non nomina nulla: quello
// che c'è finisce sul filo, quello che non c'è non manca a nessuno.
/** @type {Readonly<Record<string, readonly string[]>>} */
export const REQUIRED = Object.freeze({
  positions: Object.freeze([
    "id",
    "status",
    "company",
    "source",
    "found_at",
    "company_id",
    "title",
  ]),
  scores: Object.freeze(["position_id", "total_score"]),
  applications: Object.freeze([
    "position_id",
    "status",
    "critic_verdict",
    "applied_at",
    "written_at",
    "id",
  ]),
  companies: Object.freeze(["id", "hq_country", "verdict"]),
});

/** I soli nomi di tabella che questo modulo passa a SQLite. */
export const REQUIRED_TABLES = Object.freeze(Object.keys(REQUIRED));

// [JHT-TEAM-API-BOUNDARY] Le due letture di introspezione, come costanti.
//
// `type IN ('table','view')`: una vista che si chiama `positions` soddisfa la
// route esattamente come una tabella — `pragma_table_info` funziona su
// entrambe, e chi legge non deve sapere quale delle due gli stanno servendo.
//
// `pragma_table_info(?)` invece di `PRAGMA table_info(<nome>)`: la forma
// tabellare accetta un parametro LEGATO, quindi in questo file non esiste una
// sola stringa SQL costruita per concatenazione. Vale anche se oggi i nomi
// arrivano solo da `REQUIRED`: la proprietà da mantenere è «qui non si
// interpola», non «qui si interpola una cosa fidata».
const TABLES_AND_VIEWS_SQL =
  "SELECT name FROM sqlite_master WHERE type IN ('table','view')";
const TABLE_COLUMNS_SQL = "SELECT name FROM pragma_table_info(?)";
const USER_VERSION_SQL = "PRAGMA user_version";

/**
 * Il numero di versione dello schema, o `null` se il database non sa dirlo.
 *
 * La riga che torna è `{ user_version: 7 }`: si legge per POSIZIONE e non per
 * nome, come fa il Python (`fetchone()[0]`), perché il nome della colonna di
 * un PRAGMA è un dettaglio del driver e non un contratto.
 *
 * @param {{ prepare: (sql: string) => { get: (...p: unknown[]) => unknown } }} conn
 * @returns {number | null}
 */
function readUserVersion(conn) {
  const row = conn.prepare(USER_VERSION_SQL).get();
  if (!row || typeof row !== "object") return null;
  const value = Object.values(row)[0];
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

/**
 * Il censimento vero e proprio.
 *
 * `missing` ha due forme, e la differenza conta per chi legge:
 *   - `"companies"` — la tabella non c'è affatto (e allora non si elencano le
 *     sue colonne: sarebbero righe di rumore che dicono la stessa cosa);
 *   - `"positions.found_at"` — la tabella c'è, quella colonna no.
 *
 * `missing: []` significa «completo», ed è l'unico valore su cui una route dati
 * può rispondere 200. L'ordine è quello di `REQUIRED`, sempre.
 *
 * @param {{ prepare: (sql: string) => { all: (...p: unknown[]) => unknown[], get: (...p: unknown[]) => unknown } }} conn
 *   connessione SOLA LETTURA già aperta (la apre e la chiude il chiamante)
 * @returns {{ userVersion: number | null, missing: string[] }}
 */
export function census(conn) {
  /** @type {string[]} */
  const missing = [];
  const existing = new Set(
    conn
      .prepare(TABLES_AND_VIEWS_SQL)
      .all()
      .map((row) => String(/** @type {{ name: unknown }} */ (row).name)),
  );

  for (const table of REQUIRED_TABLES) {
    if (!existing.has(table)) {
      missing.push(table);
      continue;
    }
    const columns = new Set(
      conn
        .prepare(TABLE_COLUMNS_SQL)
        .all(table)
        .map((row) => String(/** @type {{ name: unknown }} */ (row).name)),
    );
    for (const column of REQUIRED[table]) {
      if (!columns.has(column)) missing.push(`${table}.${column}`);
    }
  }

  return { userVersion: readUserVersion(conn), missing };
}

/**
 * L'elenco `missing` di un database che non si può nemmeno aprire.
 *
 * Serve a chi deve rispondere a `GET /version` quando `jobs.db` non c'è: un
 * `missing: []` in quel caso direbbe «schema completo» di un database
 * inesistente, che è la bugia più comoda e la meno utile. Le quattro tabelle
 * mancano tutte, ed è esattamente quello che si legge.
 *
 * @returns {string[]}
 */
export function allTablesMissing() {
  return [...REQUIRED_TABLES];
}

/**
 * L'avviso da scrivere UNA volta all'avvio quando il timbro non è quello
 * atteso, o `null` se non c'è niente da dire.
 *
 * La frase vive qui, accanto alla costante che la motiva, così esiste in un
 * posto solo: chi supervisiona il processo la logga e non deve inventarsi le
 * parole (e in particolare non deve trasformarla in un errore — è un avviso, e
 * il resto del file spiega perché).
 *
 * @param {number | null} userVersion
 * @returns {string | null}
 */
export function userVersionWarning(userVersion) {
  if (userVersion === null) {
    return (
      "The team database does not report a schema version; " +
      `the expected stamp is ${EXPECTED_USER_VERSION}. Serving anyway: ` +
      "the routes check for the tables and columns they read, not for this number."
    );
  }
  if (userVersion === EXPECTED_USER_VERSION) return null;
  return (
    `The team database is stamped schema version ${userVersion} while this ` +
    `image expects ${EXPECTED_USER_VERSION}. Serving anyway: only the Python ` +
    "agents migrate the database, and they do it the first time they read it. " +
    "Start the team once if a route reports a missing column."
  );
}
