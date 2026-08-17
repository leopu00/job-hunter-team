// [JHT-TEAM-API-BOUNDARY] Lettura di `jobs.db` per l'API di loopback del team.
/**
 * L'unico modulo JavaScript che apre il database del team, e lo apre SOLO in
 * lettura.
 *
 * Cos'è, in una riga: l'SQL di `shared/skills/db_query.py` ri-espresso in JS
 * puro, perché il payload sul filo sia lo STESSO che `jht positions --json`
 * stampa oggi.
 *
 * ⚠️ È una FORCELLA dichiarata, non una convergenza
 * ------------------------------------------------
 * Dopo questo ticket il repo legge `jobs.db` in tre dialetti:
 * `shared/skills/db_query.py` (Python, ancora consumato dal gioco via
 * `game/scripts/backend/vps_backend.gd`), `web/lib/local-queries.ts`
 * (TypeScript, quello del web) e questo file. La decisione 4 di
 * ADR-0009 dice che il server porta `web/lib/`: questo file è registrato
 * nell'ADR come DEPARTURE da quella lettera, con la sua strada di rientro.
 * Non è un dettaglio da scoprire leggendo il codice: è una scommessa
 * consapevole, e il suo prezzo è che l'SQL qui dentro **non si tocca a mano**
 * senza guardare il Python. Due cancelli la tengono onesta:
 *   1. `tests/js/tasks/api-read-sql-drift.test.ts` — estrae l'SQL da
 *      `db_query.py` e lo confronta, testo contro testo, con le costanti qui;
 *   2. `tests/test_api_read_parity.py` — confronta i VALORI: stesso database,
 *      `db_query.py --json` contro questo lettore, JSON contro JSON.
 * Il primo prende le riscritture, il secondo prende quello che il testo non
 * vede (coercizioni di tipo, NULL, ordine a parità, insieme delle chiavi).
 *
 * Il driver è INIETTATO (`DatabaseSync` di `node:sqlite`), come fa già
 * `readLocalSignature` in `cli/src/lib/bootstrap-push.js:154`. Due ragioni, e
 * la seconda è misurata: il modulo resta importabile e testabile senza toccare
 * il filesystem, e `import 'node:sqlite'` stampa su stderr
 * «ExperimentalWarning: SQLite is an experimental feature…» a ogni caricamento
 * (verificato su node v22.20.0, in tutte e tre le forme: import statico,
 * import dinamico, require). Chi carica il driver è UN posto solo — l'avvio
 * del server — e lì l'avviso si accetta a occhi aperti: finisce una volta per
 * boot in `logs/api.log`, che è il file dove uno che indaga vuole trovarlo.
 * Silenziarlo dentro questo modulo lo nasconderebbe anche a chi lo importa per
 * altro. Qui dentro, di quell'avviso non ne nasce nessuno.
 *
 * Cosa questo modulo NON fa, mai: scrivere. Nessun `PRAGMA journal_mode`,
 * nessun DDL, nessuna creazione di cartelle, e nessun driver nativo (quello del
 * web, che l'immagine del container non installa affatto). La sola
 * scrittura di tutto il file sta nella sonda `probeReadOnly()`, su un database
 * usa-e-getta in `os.tmpdir()`, e serve appunto a dimostrare che sul database
 * vero non si può scrivere.
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  allTablesMissing,
  census as schemaCensus,
  EXPECTED_USER_VERSION,
} from './schema-census.js';

// [JHT-TEAM-API-BOUNDARY] Il vocabolario degli errori che questo modulo alza.
//
// Sono CHIAVI di `ERROR_CODES` in `shared/api/contract.js`: chi risponde alla
// richiesta traduce il codice in status e frase. Non importiamo quel file di
// proposito — questo resta un modulo dati, che non sa niente di HTTP e si
// riesce a usare da uno script o da un test senza tirarsi dietro il contratto
// del filo. Il prezzo di una copia (un nome che deriva) lo paga un test:
// `api-readonly-handle.test.ts` pretende che ognuna di queste chiavi esista
// davvero in `ERROR_CODES`, altrimenti un codice sconosciuto scivolerebbe in
// un 500 generico e il 503 che serviva non arriverebbe mai.
export const READ_ERROR_CODES = Object.freeze({
  DB_UNAVAILABLE: 'DB_UNAVAILABLE',
  DB_SCHEMA_INCOMPLETE: 'DB_SCHEMA_INCOMPLETE',
  UNSUPPORTED_COLUMN_TYPE: 'UNSUPPORTED_COLUMN_TYPE',
  QUERY_PARAM_UNKNOWN: 'QUERY_PARAM_UNKNOWN',
  QUERY_PARAM_MALFORMED: 'QUERY_PARAM_MALFORMED',
  INTERNAL: 'INTERNAL',
});

/**
 * Un errore con un codice che chi risponde sa tradurre.
 *
 * `message` è inglese e sicuro da mostrare (mai una traccia, mai il testo del
 * driver); il dettaglio tecnico viaggia in `cause`, che è roba da
 * `logs/api.log`.
 *
 * @param {string} code una chiave di `READ_ERROR_CODES`
 * @param {string} message frase inglese, mostrabile
 * @param {unknown} [cause] l'errore originale, per il log
 * @returns {Error & { code: string }}
 */
function readError(code, message, cause) {
  const error = /** @type {Error & { code: string }} */ (new Error(message));
  error.code = code;
  if (cause !== undefined) error.cause = cause;
  return error;
}

/** Il testo di un errore qualunque, senza fidarsi della sua forma. */
function messageOf(error) {
  if (error && typeof error === 'object' && 'message' in error) {
    return String(/** @type {{ message: unknown }} */ (error).message);
  }
  return String(error);
}

// ── L'SQL, portato VERBATIM da shared/skills/db_query.py ─────────────────
//
// [JHT-TEAM-API-BOUNDARY] Non «equivalente»: identico. L'indentazione e i nomi
// degli alias sono quelli del Python perché il confronto di drift avvenga su un
// testo che si legge in parallelo, e perché l'insieme delle chiavi del JSON di
// uscita è deciso dagli alias (`a.status as app_status`, `c.hq_country as
// c_hq_country`): cambiarne uno cambia il payload di un client che non sa di
// essere cambiato.

/** `db_query.py:135-143` (`query_positions`). */
export const POSITIONS_SELECT = `
        SELECT p.*, s.total_score, a.status as app_status, a.critic_verdict,
               c.hq_country as c_hq_country, c.verdict as company_verdict
        FROM positions p
        LEFT JOIN scores s ON s.position_id = p.id
        LEFT JOIN applications a ON a.position_id = p.id
        LEFT JOIN companies c ON c.id = p.company_id
        WHERE 1=1
    `;

/**
 * I cinque filtri di `db_query.py:146-160`, **nell'ordine del Python**.
 *
 * L'ordine conta due volte: è l'ordine in cui le clausole si concatenano (e
 * quindi il testo che il test di drift confronta) ed è l'ordine dei parametri
 * legati. Per questo si itera SEMPRE su questa mappa, mai sulle chiavi che
 * arriva a passare il chiamante.
 *
 * `company` è `p.company LIKE '%valore%'` e nient'altro: NON è una ricerca
 * libera su titolo/città/paese/famiglia-ruolo/fonte. Un client che cercasse
 * «Stripe» e ricevesse anche le posizioni il cui TITOLO contiene «Stripe»
 * leggerebbe una risposta a una domanda diversa da quella che ha fatto.
 *
 * @type {Readonly<Record<string, Readonly<{ clause: string, integer?: boolean, param?: (v: any) => any }>>>}
 */
export const POSITIONS_FILTERS = Object.freeze({
  status: Object.freeze({ clause: ' AND p.status = ?' }),
  company: Object.freeze({
    clause: ' AND p.company LIKE ?',
    param: (value) => `%${value}%`,
  }),
  minScore: Object.freeze({ clause: ' AND s.total_score >= ?', integer: true }),
  maxScore: Object.freeze({ clause: ' AND s.total_score <= ?', integer: true }),
  source: Object.freeze({ clause: ' AND p.source = ?' }),
});

/** `db_query.py:162`. */
export const POSITIONS_ORDER_BY =
  ' ORDER BY COALESCE(s.total_score, 0) DESC, p.found_at DESC';

/** `db_query.py:194-207` (`query_position_detail`), `WHERE p.id = ?`. */
export const POSITION_DETAIL_SELECT = `
        SELECT p.*, s.total_score, s.stack_match, s.remote_fit, s.salary_fit,
               s.experience_fit, s.strategic_fit, s.breakdown as score_breakdown, s.notes as score_notes,
               a.cv_path, a.cl_path, a.cv_pdf_path, a.cl_pdf_path,
               a.critic_verdict, a.critic_score, a.critic_notes,
               a.status as app_status, a.written_at, a.applied_at, a.applied_via,
               a.response, a.response_at,
               c.hq_country as c_hq_country, c.verdict as company_verdict, c.sector as c_sector
        FROM positions p
        LEFT JOIN scores s ON s.position_id = p.id
        LEFT JOIN applications a ON a.position_id = p.id
        LEFT JOIN companies c ON c.id = p.company_id
        WHERE p.id = ?
    `;

/**
 * `db_query.py:375-382`. Sta fuori dal ramo `--json` nel Python (la usano
 * entrambe le uscite) e produce sia `total` sia `by_status`.
 */
export const DASHBOARD_BY_STATUS = `
        SELECT status, COUNT(*) as cnt FROM positions GROUP BY status ORDER BY
        CASE status
            WHEN 'new' THEN 1 WHEN 'checked' THEN 2 WHEN 'scored' THEN 3
            WHEN 'writing' THEN 4 WHEN 'review' THEN 5 WHEN 'ready' THEN 6
            WHEN 'applied' THEN 7 WHEN 'response' THEN 8 ELSE 9
        END
    `;

/** `db_query.py:390-394`. Il `LIMIT 10` è del Python: è parità, non una scelta. */
export const DASHBOARD_TOP_SCORES = `
                SELECT p.id, p.title, p.company, s.total_score, p.status
                FROM positions p JOIN scores s ON s.position_id = p.id
                ORDER BY s.total_score DESC LIMIT 10
            `;

/** `db_query.py:395-400`. */
export const DASHBOARD_APPLICATIONS = `
                SELECT p.id AS position_id, p.company, p.title, a.status,
                       a.critic_verdict, a.applied_at, a.written_at
                FROM applications a JOIN positions p ON p.id = a.position_id
                ORDER BY a.id DESC
            `;

/** `db_query.py:403-405`, dove il Python concatena due letterali adiacenti. */
export const DASHBOARD_COMPANIES_BY_VERDICT =
  'SELECT verdict, COUNT(*) as cnt FROM companies ' +
  'WHERE verdict IS NOT NULL GROUP BY verdict';

/** `db_query.py:407-409`. */
export const DASHBOARD_POSITIONS_WITH_COMPANY_ID =
  'SELECT COUNT(*) FROM positions WHERE company_id IS NOT NULL';

/**
 * Le sei chiavi di `dashboard --json`, **nell'ordine in cui il Python le
 * costruisce** (`db_query.py:388-409`). L'ordine non serve a JSON, serve a chi
 * confronta due uscite a occhio.
 */
export const DASHBOARD_KEYS = Object.freeze([
  'total',
  'by_status',
  'top_scores',
  'applications',
  'companies_by_verdict',
  'positions_with_company_id',
]);

// ── Fedeltà dei tipi ────────────────────────────────────────────────────
//
// [JHT-TEAM-API-BOUNDARY] Regola obbligatoria: un valore che non è
// `number | string | boolean | null` NON va sul filo, si alza
// `UNSUPPORTED_COLUMN_TYPE`.
//
// Il Python serializza con `json.dumps(payload, default=str)`
// (`db_query.py:89-90`): qualunque tipo nuovo diventa la sua stringa. Node no.
// Misurato su v22.20.0: una colonna BLOB torna come `Uint8Array`, e
// `JSON.stringify` di un `Uint8Array` è `{"0":1,"1":2}` — un oggetto
// plausibile, sbagliato, che nessun client sospetterebbe. Meglio un 500 che si
// nota di una risposta credibile che non lo è.
//
// I numeri non finiti stanno nella stessa regola per la stessa ragione:
// `JSON.stringify(Infinity)` è `null`, cioè «colonna vuota» al posto di un
// valore che c'è. SQLite quel valore lo sa produrre (`9e999`).
const WIRE_TYPES = new Set(['number', 'string', 'boolean']);

/** Il TIPO di un valore, per il messaggio d'errore. Mai il valore. */
function describeType(value) {
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object' && value !== null) {
    const name = /** @type {{ constructor?: { name?: string } }} */ (value)
      .constructor?.name;
    return name ? `object (${name})` : 'object';
  }
  if (typeof value === 'number') return 'non-finite number';
  return typeof value;
}

/**
 * La riga come la vuole il filo: oggetto NORMALE, valori verificati.
 *
 * Il driver restituisce oggetti con prototipo `null` (misurato): JSON li
 * digerisce, ma chiunque chiami `row.hasOwnProperty(...)` o passi la riga a
 * una libreria che cammina il prototipo trova un oggetto che si comporta in
 * modo strano per ragioni invisibili. Si copia in un oggetto normale nella
 * stessa passata in cui si controllano i tipi: una sola scansione, e le chiavi
 * restano nell'ordine delle colonne.
 *
 * @param {Record<string, unknown>} row
 * @returns {Record<string, number | string | boolean | null>}
 */
function toWireRow(row) {
  /** @type {Record<string, number | string | boolean | null>} */
  const out = {};
  for (const key of Object.keys(row)) {
    const value = row[key];
    if (value === null || value === undefined) {
      out[key] = null;
      continue;
    }
    const kind = typeof value;
    if (!WIRE_TYPES.has(kind) || (kind === 'number' && !Number.isFinite(value))) {
      throw readError(
        READ_ERROR_CODES.UNSUPPORTED_COLUMN_TYPE,
        `Column "${key}" holds a value the team API cannot put on the wire ` +
          `(${describeType(value)}).`
      );
    }
    out[key] = /** @type {number | string | boolean} */ (value);
  }
  return out;
}

// ── Apertura in SOLA LETTURA: un posto solo, una grafia sola ─────────────
//
// [JHT-TEAM-API-BOUNDARY] ⚠️ La trappola misurata, ed è di UN carattere.
//
// Node non convalida le chiavi delle opzioni di `DatabaseSync`. Misurato su
// node v22.20.0 su questa macchina, sullo stesso file:
//   · `{ readOnly: true }`  → l'INSERT fallisce con ERR_SQLITE_ERROR
//     («attempt to write a readonly database»): è quello che vogliamo;
//   · la stessa opzione scritta con la «o» minuscola → l'INSERT PASSA;
//   · un'opzione inventata (`{ bogus: true }`) → l'INSERT PASSA.
// Cioè una grafia sbagliata non è un errore: è un handle SCRIVIBILE sul
// `jobs.db` vivo del team, mentre gli agenti Python scrivono in WAL. Per
// questo l'apertura sta in UNA funzione e la sonda di avvio passa da QUESTA
// funzione: una sonda che aprisse un handle con la sua copia del letterale
// resterebbe verde davanti a una regressione qui.
/**
 * @param {Function} DatabaseSync la classe di `node:sqlite`, iniettata
 * @param {string} path percorso del file di database
 * @returns {any} handle di sola lettura
 */
function openReadonly(DatabaseSync, path) {
  return new DatabaseSync(path, { readOnly: true });
}

/** Chiude un handle senza far rumore: sul secondo `close()` il driver alza
 * ERR_INVALID_STATE (misurato), e in un `finally` non serve a nessuno. */
function closeQuietly(handle) {
  try {
    handle?.close();
  } catch {
    /* già chiuso, o mai aperto */
  }
}

/**
 * [JHT-TEAM-API-BOUNDARY] La sonda: la sola lettura è DAVVERO applicata?
 *
 * Costruisce un database usa-e-getta in `os.tmpdir()`, lo riapre con
 * `open` (di default la `openReadonly` vera) e prova a scriverci. Riporta se
 * la scrittura è stata bloccata; non decide niente — chi avvia il server
 * decide, e deve rifiutarsi di ascoltare su una porta se `blocked` non è
 * `true`.
 *
 * `blocked: false` anche quando la sonda non riesce a girare del tutto (per
 * esempio `os.tmpdir()` non scrivibile). È voluto: una garanzia di sola
 * lettura che non si riesce a DIMOSTRARE vale come una garanzia mancata, e il
 * modo giusto di sbagliare qui è rifiutare l'avvio con una riga di log, non
 * servire dati con un handle di cui non sappiamo niente.
 *
 * `open` è iniettabile per una ragione sola: permettere al test di passare una
 * copia deliberatamente sbagliata (la grafia con la «o» minuscola) e verificare
 * che la sonda la BOCCI. Senza quel contronegativo la sonda potrebbe essere
 * verde perché non sa vedere niente.
 *
 * @param {{ DatabaseSync: Function, open?: (D: Function, p: string) => any }} deps
 * @returns {{ blocked: boolean, detail: string }}
 */
export function probeReadOnly({ DatabaseSync, open = openReadonly }) {
  let dir = null;
  let writer = null;
  let reader = null;
  try {
    dir = mkdtempSync(join(tmpdir(), 'jht-api-readonly-'));
    const file = join(dir, 'probe.db');
    writer = new DatabaseSync(file);
    // `prepare(...).run()` e non `exec(...)`: la seconda forma non serve a
    // nulla qui, e non averla nel file rende vero senza discussioni che questo
    // modulo non esegue DDL su niente che non sia questo file temporaneo.
    writer.prepare('CREATE TABLE probe (touched INTEGER)').run();
    closeQuietly(writer);
    writer = null;

    reader = open(DatabaseSync, file);
    try {
      reader.prepare('INSERT INTO probe (touched) VALUES (1)').run();
      return {
        blocked: false,
        detail:
          'The probe INSERT went through: this build opens the team database ' +
          'with a WRITABLE handle.',
      };
    } catch (error) {
      return {
        blocked: true,
        detail: `The probe INSERT was refused by SQLite: ${messageOf(error)}`,
      };
    }
  } catch (error) {
    return {
      blocked: false,
      detail: `The read-only probe could not run: ${messageOf(error)}`,
    };
  } finally {
    closeQuietly(writer);
    closeQuietly(reader);
    // Su Windows un handle ancora aperto rende il file impossibile da
    // cancellare (EBUSY, misurato): gli `closeQuietly` qui sopra non sono
    // igiene, sono la condizione perché questa riga funzioni.
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* la cartella temporanea resta: fastidio, non guasto */
      }
    }
  }
}

/**
 * L'intero che un valore numerico deve essere, o `QUERY_PARAM_MALFORMED`.
 *
 * Il Python dichiara `--min-score`/`--max-score` e l'id del dettaglio come
 * `type=int` (`db_query.py:1445-1446`, `:1452`): un valore non intero là non
 * arriva nemmeno alla query, argparse esce prima. Sul filo invece è sempre
 * testo, quindi la conversione si fa una volta e in un posto solo.
 *
 * `label` è il nome della cosa nella frase d'errore, che l'utente legge.
 */
function coerceInteger(label, raw) {
  const value =
    typeof raw === 'string' && /^-?\d+$/.test(raw.trim())
      ? Number(raw.trim())
      : raw;
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw readError(
      READ_ERROR_CODES.QUERY_PARAM_MALFORMED,
      `The ${label} must be a plain integer.`
    );
  }
  return value;
}

/** Il testo di un filtro non numerico, nella forma in cui lo passa il Python. */
function coerceText(label, raw) {
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  throw readError(
    READ_ERROR_CODES.QUERY_PARAM_MALFORMED,
    `The ${label} must be text.`
  );
}

// [JHT-TEAM-API-BOUNDARY] La verità «alla Python», e il suo effetto collaterale.
//
// Il Python scrive `if args.min_score:`, non `is not None`. Conseguenza esatta:
// `--min-score 0` NON aggiunge la clausola. Non è un dettaglio senza effetto —
// `AND s.total_score >= 0` escluderebbe le posizioni senza score, perché NULL
// non soddisfa il confronto — ed è comunque il comportamento da riprodurre:
// la parità con `db_query.py --json` è il contratto di questa fase, e una
// «correzione» qui sarebbe una differenza silenziosa fra due uscite che i
// client credono uguali. Chi vorrà cambiarla lo farà nei due posti insieme.
function isPythonTruthy(value) {
  return !(
    value === undefined ||
    value === null ||
    value === '' ||
    value === 0 ||
    value === false
  );
}

/**
 * L'SQL di `/v1/positions` e i suoi parametri, montati come nel Python.
 *
 * Esportata perché il montaggio si possa provare senza un database: è la parte
 * dove un filtro si perde per strada, e un filtro perso non si vede
 * nell'output (si vede solo che ci sono più righe di quelle chieste).
 *
 * @param {Record<string, unknown>} [filters]
 * @returns {{ sql: string, params: unknown[] }}
 */
export function buildPositionsQuery(filters = {}) {
  // Chiave non prevista → errore, non silenzio: ignorarla vorrebbe dire
  // rispondere a una domanda diversa da quella fatta. Il controllo sta anche
  // qui, oltre che in chi riceve la richiesta HTTP: è l'ultima serratura prima
  // dell'SQL, e questo modulo lo usano anche script e test.
  for (const key of Object.keys(filters)) {
    if (!Object.hasOwn(POSITIONS_FILTERS, key)) {
      throw readError(
        READ_ERROR_CODES.QUERY_PARAM_UNKNOWN,
        `The positions query has no ${key} filter.`
      );
    }
  }

  let sql = POSITIONS_SELECT;
  /** @type {unknown[]} */
  const params = [];
  for (const [name, spec] of Object.entries(POSITIONS_FILTERS)) {
    const raw = filters[name];
    // Assente o vuoto: clausola assente, ed è già la regola del Python
    // (`--status ''` non filtra niente). Si scarta prima di convertire, così
    // un vuoto non diventa mai un errore di formato.
    if (raw === undefined || raw === null || raw === '') continue;
    const value = spec.integer
      ? coerceInteger(`${name} filter`, raw)
      : coerceText(`${name} filter`, raw);
    // Qui cade lo zero: `if args.min_score:` nel Python fa lo stesso.
    if (!isPythonTruthy(value)) continue;
    sql += spec.clause;
    params.push(spec.param ? spec.param(value) : value);
  }
  sql += POSITIONS_ORDER_BY;
  return { sql, params };
}

/**
 * Il lettore di `jobs.db`: sola lettura, driver iniettato, handle in cache.
 *
 * @param {{ DatabaseSync: Function, dbPath: string }} deps
 */
export function createReadonlyBackend({ DatabaseSync, dbPath }) {
  if (typeof DatabaseSync !== 'function') {
    throw new TypeError(
      'createReadonlyBackend needs the DatabaseSync class of node:sqlite.'
    );
  }
  if (typeof dbPath !== 'string' || dbPath.trim() === '') {
    throw new TypeError(
      'createReadonlyBackend needs the path of the team database as dbPath.'
    );
  }

  /** @type {any} */
  let handle = null;
  // [JHT-TEAM-API-BOUNDARY] La verità sulla connessione è NOSTRA, un booleano
  // di questo modulo, scritto solo qui in apertura e in chiusura.
  //
  // Non si interroga il driver, e non per gusto: su node v22.20.0 il campo
  // `open` di `DatabaseSync` è una FUNZIONE, quindi sempre vero se lo si usa
  // come booleano, e `pragma` non esiste affatto (misurato, entrambi). Esiste
  // anche un campo booleano più recente, ma la minor version di Node
  // nell'immagine non è verificata (il digest di `Dockerfile:9` è congelato dal
  // 2026-04-27): se mancasse leggeremmo `undefined`, e la guardia non
  // scatterebbe mai — in silenzio, che è il modo peggiore.
  let live = false;
  /** @type {boolean | null} */
  let readOnlyEnforced = null;

  function closeHandle() {
    if (!live && handle === null) return;
    live = false;
    const previous = handle;
    handle = null;
    closeQuietly(previous);
  }

  function ensureOpen() {
    // Lo `stat` a OGNI chiamata, non solo alla prima. Su Linux un file
    // cancellato resta leggibile dal descrittore già aperto: un handle in
    // cache continuerebbe a servire il contenuto di un `jobs.db` che non
    // esiste più. «La dashboard risponde su un database cancellato» è un
    // difetto peggiore di un 503, e costa una syscall per richiesta.
    if (!existsSync(dbPath)) {
      closeHandle();
      throw readError(
        READ_ERROR_CODES.DB_UNAVAILABLE,
        `The team database does not exist at ${dbPath}.`
      );
    }
    if (live && handle !== null) return handle;
    try {
      handle = openReadonly(DatabaseSync, dbPath);
      live = true;
    } catch (error) {
      handle = null;
      live = false;
      throw readError(
        READ_ERROR_CODES.DB_UNAVAILABLE,
        `The team database at ${dbPath} could not be opened for reading.`,
        error
      );
    }
    return handle;
  }

  /**
   * Traduce l'errore del driver nel vocabolario del contratto.
   *
   * «no such table/column» è la forma che prende uno schema più vecchio delle
   * route: è un 503 `DB_SCHEMA_INCOMPLETE` («torna dopo aver avviato il team,
   * che migra leggendo»), non un 500. È anche la rete che raccoglie le colonne
   * fuori dal censimento — quelle che solo il dettaglio di una posizione legge.
   */
  function translateDriverError(error) {
    const code = /** @type {{ code?: unknown }} */ (error)?.code;
    if (typeof code === 'string' && Object.hasOwn(READ_ERROR_CODES, code)) {
      return error;
    }
    const text = messageOf(error);
    if (/no such (table|column)/i.test(text)) {
      return readError(
        READ_ERROR_CODES.DB_SCHEMA_INCOMPLETE,
        'The team database is missing a table or a column this route reads.',
        error
      );
    }
    if (/locked|busy/i.test(text)) {
      return readError(
        READ_ERROR_CODES.DB_UNAVAILABLE,
        'The team database is busy right now: retry in a moment.',
        error
      );
    }
    if (/unable to open|not a database|disk i\/o|malformed/i.test(text)) {
      return readError(
        READ_ERROR_CODES.DB_UNAVAILABLE,
        'The team database cannot be read right now.',
        error
      );
    }
    return readError(
      READ_ERROR_CODES.INTERNAL,
      'The team API failed to read the team database.',
      error
    );
  }

  /** Ogni lettura passa da qui: apertura garantita, errori tradotti. */
  function runRead(read) {
    const conn = ensureOpen();
    try {
      return read(conn);
    } catch (error) {
      throw translateDriverError(error);
    }
  }

  return Object.freeze({
    /** Il percorso su cui questo lettore è stato costruito. */
    dbPath,

    /** Vero se un handle è aperto ADESSO. Vedi il commento su `live`. */
    isLive() {
      return live;
    },

    /**
     * L'handle di sola lettura, aperto se serve.
     *
     * Esiste per due usi, ed entrambi sono voluti: il censimento dello schema
     * (`census(conn)` vive in `schema-census.js`) e la PROVA della sola
     * lettura — il test prepara una `UPDATE` da qui e pretende che `run()`
     * fallisca. Non è una scorciatoia per aggiungere query fuori da questo
     * file: quelle vanno accanto alle altre, dove il drift le vede.
     */
    connection() {
      return ensureOpen();
    },

    /** Chiude l'handle. Idempotente, chiamabile in un `finally`. */
    close() {
      closeHandle();
    },

    /**
     * La sonda della sola lettura, per la sequenza di avvio.
     *
     * Passa dalla STESSA `openReadonly` dell'handle vero: è tutto il punto
     * della sonda. Ricorda il verdetto per `GET /version`.
     */
    assertReadOnly() {
      const verdict = probeReadOnly({ DatabaseSync });
      readOnlyEnforced = verdict.blocked;
      return verdict;
    },

    /**
     * Il blocco `db` di `GET /version`. Non alza MAI: `/version` deve
     * rispondere 200 anche quando il database non c'è — è la route che serve
     * proprio a scoprirlo.
     *
     * `readOnlyEnforced` è `null` finché `assertReadOnly()` non ha girato:
     * «non lo sappiamo» non è «sì».
     */
    describeDb() {
      const present = existsSync(dbPath);
      let readable = false;
      if (present) {
        try {
          ensureOpen();
          readable = true;
        } catch {
          readable = false;
        }
      }
      return { present, readable, readOnlyEnforced, path: dbPath };
    },

    /**
     * Il censimento per `GET /version` e per il 503 delle route dati.
     *
     * Non alza mai, per la stessa ragione di `describeDb()`. Chi risponde
     * guarda `present` PRIMA di `missing`: un database che non c'è è
     * `DB_UNAVAILABLE`, non `DB_SCHEMA_INCOMPLETE`, e i due 503 dicono
     * all'utente due cose diverse da fare.
     *
     * @returns {{ present: boolean, readable: boolean, userVersion: number | null,
     *   expected: number, missing: string[], reason: string | null }}
     */
    census() {
      if (!existsSync(dbPath)) {
        return {
          present: false,
          readable: false,
          userVersion: null,
          expected: EXPECTED_USER_VERSION,
          missing: allTablesMissing(),
          reason: `The team database does not exist at ${dbPath}.`,
        };
      }
      try {
        const result = schemaCensus(ensureOpen());
        return {
          present: true,
          readable: true,
          userVersion: result.userVersion,
          expected: EXPECTED_USER_VERSION,
          missing: result.missing,
          reason: null,
        };
      } catch {
        return {
          present: true,
          readable: false,
          userVersion: null,
          expected: EXPECTED_USER_VERSION,
          missing: allTablesMissing(),
          reason: `The team database at ${dbPath} exists but cannot be read.`,
        };
      }
    },

    /**
     * `GET /v1/positions`: array NUDO di righe, come
     * `db_query.py positions --json`.
     *
     * Nessun `LIMIT`: è parità con il Python, ed è debito noto e registrato —
     * il primo client che la interrogherà a orologio lo troverà.
     *
     * @param {Record<string, unknown>} [filters]
     */
    listPositions(filters = {}) {
      const { sql, params } = buildPositionsQuery(filters);
      const rows = runRead((conn) => conn.prepare(sql).all(...params));
      return rows.map(toWireRow);
    },

    /**
     * `GET /v1/positions/{id}`: la riga, o `null` se non c'è.
     *
     * `null` e non un errore: è il Python a decidere il contratto
     * (`db_query.py:212`, «assente → null»), e la corsia `--json` del CLI
     * stampa esattamente quello. Chi risponde in HTTP traduce il `null` in
     * 404 `POSITION_NOT_FOUND`.
     */
    getPosition(id) {
      const key = coerceInteger('position id', id);
      const row = runRead((conn) =>
        conn.prepare(POSITION_DETAIL_SELECT).get(key)
      );
      return row ? toWireRow(/** @type {Record<string, unknown>} */ (row)) : null;
    },

    /**
     * `GET /v1/dashboard`: esattamente le sei chiavi di `DASHBOARD_KEYS`,
     * nello stesso ordine e con gli stessi valori del Python.
     *
     * Due dettagli che sembrano casuali e non lo sono:
     *   · le chiavi di `by_status` passano da `String(...)`, perché il Python
     *     usa il valore della colonna come chiave del dizionario e
     *     `json.dumps({None: 1})` produce `{"null": 1}` — la stessa cosa che
     *     fa JavaScript indicizzando con `null`;
     *   · il conteggio finale si legge per POSIZIONE (`Object.values(...)[0]`)
     *     perché la colonna si chiama `COUNT(*)`: il Python fa
     *     `fetchone()[0]` per lo stesso motivo.
     */
    getDashboard() {
      return runRead((conn) => {
        const statuses = conn
          .prepare(DASHBOARD_BY_STATUS)
          .all()
          .map(toWireRow);
        let total = 0;
        /** @type {Record<string, number>} */
        const byStatus = {};
        for (const row of statuses) {
          const count = Number(row.cnt);
          total += count;
          byStatus[String(row.status)] = count;
        }

        /** @type {Record<string, number>} */
        const companiesByVerdict = {};
        for (const row of conn
          .prepare(DASHBOARD_COMPANIES_BY_VERDICT)
          .all()
          .map(toWireRow)) {
          companiesByVerdict[String(row.verdict)] = Number(row.cnt);
        }

        const countRow = conn.prepare(DASHBOARD_POSITIONS_WITH_COMPANY_ID).get();
        const withCompanyId = Number(
          Object.values(/** @type {Record<string, unknown>} */ (countRow))[0]
        );

        return {
          total,
          by_status: byStatus,
          top_scores: conn.prepare(DASHBOARD_TOP_SCORES).all().map(toWireRow),
          applications: conn
            .prepare(DASHBOARD_APPLICATIONS)
            .all()
            .map(toWireRow),
          companies_by_verdict: companiesByVerdict,
          positions_with_company_id: withCompanyId,
        };
      });
    },
  });
}
