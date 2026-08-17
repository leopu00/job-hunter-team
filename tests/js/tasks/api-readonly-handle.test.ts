/**
 * [JHT-TEAM-API-BOUNDARY] La trappola da un carattere, misurata e chiusa.
 *
 * Node NON convalida le chiavi delle opzioni di `DatabaseSync`. Misurato su
 * node v22.20.0, sullo stesso file, il 2026-08-17:
 *
 *   new DatabaseSync(f, { readOnly: true })   → INSERT bloccato (ERR_SQLITE_ERROR)
 *   new DatabaseSync(f, { readonly: true })   → INSERT RIUSCITO
 *   new DatabaseSync(f, { bogus: true })      → INSERT RIUSCITO
 *
 * Cioè: una grafia sbagliata non è un errore, è un handle SCRIVIBILE sul
 * `jobs.db` vivo del team mentre gli agenti Python scrivono in WAL. Questo file
 * è la rete sotto quel carattere, e la tira in tre modi diversi perché uno solo
 * si può aggirare per sbaglio:
 *
 *   1. una `UPDATE` preparata sull'handle VERO di `createReadonlyBackend` deve
 *      fallire (il caso d'uso, non una simulazione);
 *   2. `assertReadOnly()` deve dire «bloccata» passando dalla stessa apertura
 *      dell'handle vero — non da una copia del letterale, che resterebbe verde
 *      davanti a una regressione;
 *   3. la stessa sonda, con una copia deliberatamente sbagliata dell'apertura,
 *      deve dire «NON bloccata»: senza questo controllo negativo la sonda
 *      potrebbe essere verde perché non sa vedere niente.
 *
 * Tutti gli handle si chiudono in un `finally`: su Windows un handle aperto
 * rende il file temporaneo impossibile da cancellare (EBUSY, misurato), e la
 * pulizia della cartella diventa spazzatura su disco.
 */
import { afterAll, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildPositionsQuery,
  createReadonlyBackend,
  DASHBOARD_KEYS,
  POSITIONS_FILTERS,
  probeReadOnly,
  READ_ERROR_CODES,
} from "../../../shared/queries/readonly-sqlite.js";
import { EXPECTED_USER_VERSION } from "../../../shared/queries/schema-census.js";
import { ERROR_CODES } from "../../../shared/api/contract.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const MODULE_FILE = path.join(ROOT, "shared/queries/readonly-sqlite.js");

/**
 * Lo schema del fixture: le colonne che i due SELECT portati da `db_query.py`
 * nominano, e una `raw BLOB` che il DB vero NON ha — serve al caso di fedeltà
 * dei tipi, che è un difetto FUTURO (la prima migrazione che aggiunge un BLOB)
 * e va provato prima che arrivi. La parità con lo schema reale la tiene il
 * cancello Python (`tests/test_api_read_parity.py`), che costruisce il DB con
 * `_db.ensure_schema`; qui serve un database vero, non lo schema vero.
 */
const FIXTURE_DDL = `
  CREATE TABLE positions (
    id INTEGER PRIMARY KEY, title TEXT, company TEXT, status TEXT, source TEXT,
    found_at TEXT, company_id INTEGER, location TEXT, raw BLOB);
  CREATE TABLE scores (
    id INTEGER PRIMARY KEY, position_id INTEGER, total_score INTEGER,
    stack_match INTEGER, remote_fit INTEGER, salary_fit INTEGER,
    experience_fit INTEGER, strategic_fit INTEGER, breakdown TEXT, notes TEXT);
  CREATE TABLE applications (
    id INTEGER PRIMARY KEY, position_id INTEGER, status TEXT, critic_verdict TEXT,
    applied_at TEXT, written_at TEXT, cv_path TEXT, cl_path TEXT, cv_pdf_path TEXT,
    cl_pdf_path TEXT, critic_score INTEGER, critic_notes TEXT, applied_via TEXT,
    response TEXT, response_at TEXT);
  CREATE TABLE companies (
    id INTEGER PRIMARY KEY, name TEXT, hq_country TEXT, verdict TEXT, sector TEXT);
  INSERT INTO positions (id, title, company, status, source, found_at, company_id)
    VALUES (1, 'Backend Engineer', 'Acme SpA', 'scored', 'linkedin', '2026-08-01', 1),
           (2, 'Stripe Integrations', 'Acme SpA', 'new', 'greenhouse', '2026-08-02', NULL),
           (3, 'Data Engineer', 'Stripe', 'new', 'lever', '2026-08-03', NULL);
  INSERT INTO scores (position_id, total_score) VALUES (1, 82), (3, 60);
  INSERT INTO applications (position_id, status, written_at) VALUES (1, 'review', '2026-08-04');
  INSERT INTO companies (id, name, hq_country, verdict) VALUES (1, 'Acme SpA', 'IT', 'GO');
  PRAGMA user_version = ${EXPECTED_USER_VERSION};
`;

const tempDirs: string[] = [];

/** Un `jobs.db` vero in una cartella tutta sua. `extra` per i casi speciali. */
function makeDb(extra = ""): string {
  const dir = mkdtempSync(path.join(tmpdir(), "jht-api-"));
  tempDirs.push(dir);
  const dbPath = path.join(dir, "jobs.db");
  const writer = new DatabaseSync(dbPath);
  try {
    writer.exec(FIXTURE_DDL + extra);
  } finally {
    writer.close();
  }
  return dbPath;
}

afterAll(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* un handle rimasto aperto: lo dicono i test, non la pulizia */
    }
  }
});

describe("la sola lettura è applicata, non dichiarata", () => {
  it("una UPDATE preparata sull'handle vero fallisce", () => {
    const backend = createReadonlyBackend({ DatabaseSync, dbPath: makeDb() });
    try {
      const statement = backend
        .connection()
        .prepare("UPDATE positions SET status=?");
      expect(
        () => statement.run("hacked"),
        "l'handle di shared/queries/readonly-sqlite.js ha SCRITTO sul database: " +
          "controlla che openReadonly() passi ancora { readOnly: true } " +
          "(camelCase) — con qualunque altra grafia Node apre in scrittura",
      ).toThrow();
    } finally {
      backend.close();
    }
  }, 15_000);

  it("assertReadOnly() riporta che la scrittura è stata bloccata", () => {
    const backend = createReadonlyBackend({ DatabaseSync, dbPath: makeDb() });
    try {
      const verdict = backend.assertReadOnly();
      expect(
        verdict.blocked,
        "la sonda di avvio non vede più la sola lettura: startApiServer() deve " +
          "rifiutarsi di ascoltare (exit 78) quando questo è false, quindi un " +
          "false qui vale come API spenta",
      ).toBe(true);
      expect(
        verdict.detail,
        "la sonda deve dire PERCHÉ: il dettaglio finisce in logs/api.log",
      ).toMatch(/refused/i);
    } finally {
      backend.close();
    }
  }, 15_000);

  it("la stessa sonda BOCCIA una apertura scritta male", () => {
    // La grafia sbagliata si compone a pezzi di proposito: scritta per intero
    // finirebbe nel testo di questo file, e il controllo di sorgente qui sotto
    // (che cerca esattamente quella grafia) diventerebbe rumoroso da leggere.
    const wrongKey = "read" + "only";
    const verdict = probeReadOnly({
      DatabaseSync,
      open: (Driver: any, file: string) => new Driver(file, { [wrongKey]: true }),
    });
    expect(
      verdict.blocked,
      "probeReadOnly() non distingue più un'apertura scrivibile da una in sola " +
        "lettura: senza questo controllo negativo assertReadOnly() sarebbe " +
        "verde per cecità, non per correttezza",
    ).toBe(false);
  }, 15_000);

  it("readOnlyEnforced resta null finché la sonda non ha girato", () => {
    const backend = createReadonlyBackend({ DatabaseSync, dbPath: makeDb() });
    try {
      expect(
        backend.describeDb().readOnlyEnforced,
        "GET /version non deve dichiarare true prima della sonda: " +
          "«non lo sappiamo» non è «sì»",
      ).toBe(null);
      backend.assertReadOnly();
      expect(backend.describeDb().readOnlyEnforced).toBe(true);
    } finally {
      backend.close();
    }
  }, 15_000);
});

describe("il modulo non ha modi di scrivere", () => {
  const source = readFileSync(MODULE_FILE, "utf8");

  it("apre con { readOnly: true } e con nessun'altra grafia", () => {
    expect(
      source.includes("{ readOnly: true }"),
      "shared/queries/readonly-sqlite.js deve aprire con { readOnly: true }: " +
        "è la sola grafia che node:sqlite onora (misurato su v22.20.0)",
    ).toBe(true);
    // Solo la grafia come CHIAVE di opzione: il messaggio di SQLite citato nei
    // commenti («attempt to write a readonly database») non è una chiave.
    expect(
      /\breadonly\s*:|['"]readonly['"]/.exec(source),
      "shared/queries/readonly-sqlite.js contiene la grafia minuscola come " +
        "chiave di opzione: Node non convalida le chiavi, quindi quella riga " +
        "apre il jobs.db del team in SCRITTURA",
    ).toBe(null);
  });

  it("non chiede al driver se è aperto, e non usa API che qui non esistono", () => {
    expect(
      /\.\s*isOpen\b/.exec(source),
      "la liveness deve restare un booleano di questo modulo: la minor version " +
        "di Node nell'immagine non è verificata e un campo assente si legge " +
        "undefined, cioè una guardia che non scatta mai",
    ).toBe(null);
    expect(
      /\.\s*open\b/.exec(source),
      "su node v22.20.0 il campo open di DatabaseSync è una FUNZIONE, quindi " +
        "sempre vero se usato come booleano",
    ).toBe(null);
    expect(
      /\.\s*pragma\s*\(/i.exec(source),
      "db.pragma(...) è l'API di un altro driver: su node:sqlite è undefined " +
        "(misurato), quindi una guardia scritta così non gira",
    ).toBe(null);
    expect(
      /\.\s*exec\s*\(/.exec(source),
      "nessun exec() in questo modulo: le letture passano da prepare(), e il " +
        "solo DDL del file (la sonda) usa prepare().run() su un file temporaneo",
    ).toBe(null);
  });

  it("i codici che alza esistono nel contratto", () => {
    // Un codice che il contratto non conosce diventa un 500 generico: il 503 di
    // uno schema incompleto arriverebbe al client come «errore interno».
    for (const code of Object.values(READ_ERROR_CODES)) {
      expect(
        Object.prototype.hasOwnProperty.call(ERROR_CODES, code),
        `READ_ERROR_CODES.${code} non è una chiave di ERROR_CODES in ` +
          "shared/api/contract.js: allinea i due elenchi, altrimenti chi " +
          "risponde non sa che status dare a questo errore",
      ).toBe(true);
    }
  });
});

describe("la liveness è nostra", () => {
  it("false prima, true dopo la prima lettura, false dopo close()", () => {
    const backend = createReadonlyBackend({ DatabaseSync, dbPath: makeDb() });
    try {
      expect(
        backend.isLive(),
        "l'apertura è pigra: nessun handle prima della prima lettura",
      ).toBe(false);
      backend.listPositions({});
      expect(backend.isLive()).toBe(true);
      backend.close();
      expect(
        backend.isLive(),
        "dopo close() la liveness deve essere false, altrimenti un secondo " +
          "close() finisce sul driver e alza ERR_INVALID_STATE (misurato)",
      ).toBe(false);
      expect(
        () => backend.close(),
        "close() deve essere idempotente: sta in un finally e in un handler " +
          "di SIGTERM",
      ).not.toThrow();
    } finally {
      backend.close();
    }
  }, 15_000);
});

describe("fedeltà dei tipi sul filo", () => {
  it("una colonna BLOB alza UNSUPPORTED_COLUMN_TYPE invece di diventare {}", () => {
    const dbPath = makeDb();
    const writer = new DatabaseSync(dbPath);
    try {
      writer.prepare("UPDATE positions SET raw=? WHERE id=1").run(
        Buffer.from([1, 2, 3]),
      );
    } finally {
      writer.close();
    }
    const backend = createReadonlyBackend({ DatabaseSync, dbPath });
    try {
      let raised: any = null;
      try {
        backend.listPositions({});
      } catch (error) {
        raised = error;
      }
      expect(
        raised?.code,
        "node:sqlite restituisce un BLOB come Uint8Array e JSON.stringify lo " +
          'rende {"0":1,"1":2}: una risposta plausibile e sbagliata. ' +
          "toWireRow() in shared/queries/readonly-sqlite.js deve alzare " +
          "UNSUPPORTED_COLUMN_TYPE",
      ).toBe(READ_ERROR_CODES.UNSUPPORTED_COLUMN_TYPE);
      expect(
        String(raised?.message ?? ""),
        "il messaggio deve nominare la colonna, non stampare il valore",
      ).toContain('"raw"');
    } finally {
      backend.close();
    }
  }, 15_000);
});

describe("i filtri di /v1/positions", () => {
  it("senza filtri non aggiunge nessuna clausola, e l'ORDER BY c'è sempre", () => {
    const { sql, params } = buildPositionsQuery({});
    expect(params, "nessun filtro, nessun parametro legato").toEqual([]);
    expect(sql).not.toContain("AND p.status");
    expect(
      sql,
      "l'ORDER BY di db_query.py:162 fa parte del contratto del payload",
    ).toContain("ORDER BY COALESCE(s.total_score, 0) DESC, p.found_at DESC");
  });

  it("con tutti i filtri le clausole escono nell'ordine del Python", () => {
    const { sql, params } = buildPositionsQuery({
      // Volutamente in ordine sparso: l'ordine delle clausole deve venire da
      // POSITIONS_FILTERS, non da come il chiamante ha scritto l'oggetto.
      source: "lever",
      minScore: 10,
      status: "new",
      maxScore: 90,
      company: "Acme",
    });
    expect(sql.slice(sql.indexOf("WHERE 1=1"))).toContain(
      " AND p.status = ? AND p.company LIKE ? AND s.total_score >= ?" +
        " AND s.total_score <= ? AND p.source = ?",
    );
    expect(
      params,
      "l'ordine dei parametri segue quello delle clausole: uno scambio qui " +
        "filtra sulla colonna sbagliata senza nessun errore SQL",
    ).toEqual(["new", "%Acme%", 10, 90, "lever"]);
  });

  it("minScore 0 NON aggiunge la clausola (parità con `if args.min_score:`)", () => {
    const { sql, params } = buildPositionsQuery({ minScore: 0 });
    expect(
      params,
      "db_query.py usa `if args.min_score:`, quindi 0 non filtra: cambiarlo qui " +
        "renderebbe diverse due uscite che i client credono uguali " +
        "(AND s.total_score >= 0 escluderebbe le posizioni senza score)",
    ).toEqual([]);
    expect(sql).not.toContain("s.total_score >=");
  });

  it("una chiave non prevista è un errore, non un silenzio", () => {
    let raised: any = null;
    try {
      buildPositionsQuery({ q: "backend" } as any);
    } catch (error) {
      raised = error;
    }
    expect(
      raised?.code,
      "ignorare un filtro sconosciuto vuol dire rispondere a una domanda " +
        "diversa da quella fatta: buildPositionsQuery deve alzare " +
        "QUERY_PARAM_UNKNOWN",
    ).toBe(READ_ERROR_CODES.QUERY_PARAM_UNKNOWN);
  });

  it("minScore non intero è QUERY_PARAM_MALFORMED", () => {
    for (const bad of ["7.5", "abc", true, {}]) {
      let raised: any = null;
      try {
        buildPositionsQuery({ minScore: bad } as any);
      } catch (error) {
        raised = error;
      }
      expect(
        raised?.code,
        `minScore=${JSON.stringify(bad)} deve essere QUERY_PARAM_MALFORMED: ` +
          "db_query.py lo dichiara type=int e argparse esce prima della query",
      ).toBe(READ_ERROR_CODES.QUERY_PARAM_MALFORMED);
    }
    expect(
      buildPositionsQuery({ minScore: "70" }).params,
      "una stringa di sole cifre è quello che arriva da una query string",
    ).toEqual([70]);
  });

  it("company filtra p.company, non il titolo", () => {
    const backend = createReadonlyBackend({ DatabaseSync, dbPath: makeDb() });
    try {
      const ids = backend.listPositions({ company: "Stripe" }).map((r) => r.id);
      expect(
        ids,
        "la posizione 2 si chiama «Stripe Integrations» ma l'azienda è Acme: " +
          "POSITIONS_FILTERS.company è p.company LIKE '%v%' e NON una ricerca " +
          "libera su titolo/città/paese",
      ).toEqual([3]);
      expect(POSITIONS_FILTERS.company.param!("X")).toBe("%X%");
    } finally {
      backend.close();
    }
  }, 15_000);
});

describe("le tre route leggono quello che il Python legge", () => {
  it("positions ordina per score e poi per data, con i NULL in fondo", () => {
    const backend = createReadonlyBackend({ DatabaseSync, dbPath: makeDb() });
    try {
      const rows = backend.listPositions({});
      expect(
        rows.map((r) => r.id),
        "ORDER BY COALESCE(s.total_score, 0) DESC, p.found_at DESC: la 2 non " +
          "ha score, quindi conta 0 e finisce ultima",
      ).toEqual([1, 3, 2]);
      expect(
        Object.keys(rows[0]),
        "gli alias del SELECT sono il contratto del payload",
      ).toContain("app_status");
      expect(rows[0].company_verdict).toBe("GO");
    } finally {
      backend.close();
    }
  }, 15_000);

  it("il dettaglio assente è null, non un oggetto vuoto", () => {
    const backend = createReadonlyBackend({ DatabaseSync, dbPath: makeDb() });
    try {
      expect(
        backend.getPosition(999),
        "db_query.py:212 stampa null per una posizione assente, e la corsia " +
          "--json del CLI stampa quel null: chi risponde in HTTP lo traduce in " +
          "404 POSITION_NOT_FOUND",
      ).toBe(null);
      expect(backend.getPosition(1)?.c_sector ?? null).toBe(null);
      expect(backend.getPosition("1")?.id).toBe(1);
    } finally {
      backend.close();
    }
  }, 15_000);

  it("dashboard ha esattamente le sei chiavi, in ordine", () => {
    const backend = createReadonlyBackend({ DatabaseSync, dbPath: makeDb() });
    try {
      const dashboard = backend.getDashboard();
      expect(
        Object.keys(dashboard),
        "le sei chiavi di db_query.py:388-409 sono il contratto " +
          "[JHT-CLI-AGENT-PARITY] di `jht positions dashboard --json`",
      ).toEqual([...DASHBOARD_KEYS]);
      expect(dashboard.total).toBe(3);
      expect(dashboard.by_status).toEqual({ new: 2, scored: 1 });
      expect(dashboard.positions_with_company_id).toBe(1);
      expect(dashboard.companies_by_verdict).toEqual({ GO: 1 });
      expect(dashboard.top_scores.map((r: any) => r.id)).toEqual([1, 3]);
    } finally {
      backend.close();
    }
  }, 15_000);
});

describe("quando il database non c'è, o è incompleto", () => {
  it("una lettura su un jobs.db cancellato è DB_UNAVAILABLE", () => {
    const dbPath = makeDb();
    const backend = createReadonlyBackend({ DatabaseSync, dbPath });
    try {
      unlinkSync(dbPath);
      let raised: any = null;
      try {
        backend.listPositions({});
      } catch (error) {
        raised = error;
      }
      expect(
        raised?.code,
        "ensureOpen() controlla l'esistenza a OGNI chiamata: su Linux un file " +
          "cancellato resta leggibile dal descrittore aperto, e servire i dati " +
          "di un database che non esiste più è peggio di un 503",
      ).toBe(READ_ERROR_CODES.DB_UNAVAILABLE);
    } finally {
      backend.close();
    }
  }, 15_000);

  it("census() e describeDb() non alzano mai: /version deve rispondere", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jht-api-"));
    tempDirs.push(dir);
    const backend = createReadonlyBackend({
      DatabaseSync,
      dbPath: path.join(dir, "jobs.db"),
    });
    try {
      const description = backend.describeDb();
      expect(description.present, "il file non esiste").toBe(false);
      expect(description.readable).toBe(false);
      const census = backend.census();
      expect(
        census.present,
        "chi risponde guarda present PRIMA di missing: un database che non " +
          "c'è è DB_UNAVAILABLE, non DB_SCHEMA_INCOMPLETE",
      ).toBe(false);
      expect(
        census.missing,
        "un missing vuoto su un database inesistente direbbe «schema completo»",
      ).toEqual(["positions", "scores", "applications", "companies"]);
      expect(census.expected).toBe(EXPECTED_USER_VERSION);
    } finally {
      backend.close();
    }
  }, 15_000);

  it("una tabella che manca finisce in census().missing", () => {
    const dbPath = makeDb("DROP TABLE companies;");
    const backend = createReadonlyBackend({ DatabaseSync, dbPath });
    try {
      const census = backend.census();
      expect(
        census.missing,
        "il 503 DB_SCHEMA_INCOMPLETE lo guida il censimento strutturale, non " +
          "il numero di versione",
      ).toEqual(["companies"]);
      expect(
        census.userVersion,
        "il timbro resta informativo e viaggia comunque in GET /version",
      ).toBe(EXPECTED_USER_VERSION);
    } finally {
      backend.close();
    }
  }, 15_000);

  it("un userVersion diverso NON è un guasto: missing resta vuoto", () => {
    const dbPath = makeDb("PRAGMA user_version = 3;");
    const backend = createReadonlyBackend({ DatabaseSync, dbPath });
    try {
      const census = backend.census();
      expect(
        census.userVersion,
        "solo il percorso Python migra, e lo fa leggendo: una macchina che ha " +
          "scaricato l'immagine nuova e non ha ancora avviato il team è " +
          "legittimamente indietro di una migrazione",
      ).toBe(3);
      expect(
        census.missing,
        "tutte le colonne che le route leggono ci sono: negare il servizio qui " +
          "sarebbe una regressione di disponibilità su un'installazione sana",
      ).toEqual([]);
    } finally {
      backend.close();
    }
  }, 15_000);

  it("una colonna che manca al dettaglio è 503, non 500", () => {
    // Le colonne che SOLO il dettaglio legge non stanno nel censimento:
    // metterle spegnerebbe con un 503 l'intera API per una route sola. Il caso
    // si gestisce dove nasce, traducendo il «no such column» del driver.
    const dbPath = makeDb("DROP TABLE scores; CREATE TABLE scores (id, position_id, total_score);");
    const backend = createReadonlyBackend({ DatabaseSync, dbPath });
    try {
      let raised: any = null;
      try {
        backend.getPosition(1);
      } catch (error) {
        raised = error;
      }
      expect(
        raised?.code,
        "translateDriverError() deve mappare «no such column» su " +
          "DB_SCHEMA_INCOMPLETE: al client serve «avvia il team, che migra " +
          "leggendo», non «errore interno»",
      ).toBe(READ_ERROR_CODES.DB_SCHEMA_INCOMPLETE);
      expect(
        String(raised?.message ?? ""),
        "il messaggio sul filo non nomina la colonna del driver",
      ).not.toContain("stack_match");
    } finally {
      backend.close();
    }
  }, 15_000);
});
