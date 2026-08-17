/**
 * [JHT-TEAM-API-BOUNDARY] Il cancello di drift sulla FORCELLA dichiarata.
 *
 * `shared/queries/readonly-sqlite.js` ri-esprime in JS l'SQL di
 * `shared/skills/db_query.py`: è una DEPARTURE dalla lettera della decisione 4
 * di ADR-0009, accettata per la fase 1 a patto che la copia non possa derivare
 * in silenzio. Questo file è metà di quella promessa — testo contro testo,
 * costa millisecondi e gira su ogni PR. L'altra metà è
 * `tests/test_api_read_parity.py`, che confronta i VALORI su un database vero:
 * il testo non vede le coercizioni di tipo, i NULL, l'ordine a parità.
 *
 * Ogni estrazione asserisce prima di tutto di aver TROVATO qualcosa (la forma
 * di `shared/config/profile-schema-crosscheck.test.ts:21-30`): una regex che
 * non aggancia più niente renderebbe questo file verde per sempre, che è il
 * modo peggiore in cui un guard di drift può rompersi. In coda c'è anche il
 * contro-controllo: su un Python mutato ad arte, l'estrazione deve accorgersene.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DASHBOARD_APPLICATIONS,
  DASHBOARD_BY_STATUS,
  DASHBOARD_COMPANIES_BY_VERDICT,
  DASHBOARD_KEYS,
  DASHBOARD_POSITIONS_WITH_COMPANY_ID,
  DASHBOARD_TOP_SCORES,
  POSITION_DETAIL_SELECT,
  POSITIONS_FILTERS,
  POSITIONS_ORDER_BY,
  POSITIONS_SELECT,
} from "../../../shared/queries/readonly-sqlite.js";
import { EXPECTED_USER_VERSION } from "../../../shared/queries/schema-census.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const DB_QUERY = path.join(ROOT, "shared/skills/db_query.py");
const DB_MODULE = path.join(ROOT, "shared/skills/_db.py");

const python = readFileSync(DB_QUERY, "utf8");
const dbPython = readFileSync(DB_MODULE, "utf8");

/** Confronto di SQL: gli spazi non contano, tutto il resto sì. */
const norm = (sql: string) => sql.replace(/\s+/g, " ").trim();

/** Il corpo di una funzione Python, dalla sua `def` alla successiva. */
function pySlice(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start + from.length);
  expect(
    start >= 0 && end > start,
    `non trovo il blocco ${from} … ${to} in shared/skills/db_query.py: ` +
      "il file è stato riorganizzato e questo estrattore va riscritto, " +
      "non ammorbidito",
  ).toBe(true);
  return source.slice(start, end);
}

/** Il primo letterale `"""…"""` di un pezzo di Python. */
function tripleQuoted(chunk: string, what: string): string {
  const match = /"""([\s\S]*?)"""/.exec(chunk);
  expect(
    match,
    `non trovo l'SQL di ${what} in shared/skills/db_query.py`,
  ).toBeTruthy();
  return match![1];
}

/** I letterali `"…"` adiacenti che il Python concatena, riuniti. */
function joinedLiterals(chunk: string, what: string): string {
  const parts = Array.from(chunk.matchAll(/"([^"\\]*)"/g)).map((m) => m[1]);
  expect(
    parts.length > 0,
    `non trovo i letterali SQL di ${what} in shared/skills/db_query.py`,
  ).toBe(true);
  return parts.join("");
}

const positionsFn = pySlice(python, "def query_positions", "def query_position_detail");
const detailFn = pySlice(python, "def query_position_detail", "def query_companies");
const dashboardFn = pySlice(python, "\ndef dashboard(", "\ndef stats(");
const dashboardJson = pySlice(dashboardFn, "if as_json:", "conn.close()");

describe("l'SQL di /v1/positions è quello di db_query.py", () => {
  it("il SELECT con i quattro LEFT JOIN è identico", () => {
    expect(
      norm(POSITIONS_SELECT),
      "POSITIONS_SELECT in shared/queries/readonly-sqlite.js non corrisponde " +
        "più a query_positions in shared/skills/db_query.py: allinea la " +
        "costante al Python (è il Python che decide il payload di " +
        "`jht positions --json`), non il contrario",
    ).toBe(norm(tripleQuoted(positionsFn, "query_positions")));
  });

  it("i cinque filtri e l'ORDER BY sono gli stessi, nello stesso ordine", () => {
    const appended = Array.from(positionsFn.matchAll(/query \+= "([^"]*)"/g)).map(
      (m) => m[1],
    );
    expect(
      appended.length,
      "in query_positions mi aspetto 5 clausole di filtro più un ORDER BY " +
        "concatenati a `query`: ne ho trovati " +
        appended.length +
        ". Se il Python ne ha aggiunto uno, va portato in POSITIONS_FILTERS",
    ).toBe(6);

    const jsClauses = Object.values(POSITIONS_FILTERS).map((spec) =>
      norm(spec.clause),
    );
    expect(
      jsClauses,
      "POSITIONS_FILTERS deve elencare le stesse clausole del Python " +
        "nell'ordine in cui il Python le concatena: l'ordine è il testo, e il " +
        "testo è quello che questo test confronta",
    ).toEqual(appended.slice(0, 5).map(norm));
    expect(
      norm(POSITIONS_ORDER_BY),
      "l'ORDER BY di db_query.py:162 decide l'ordine delle righe sul filo",
    ).toBe(norm(appended[5]));
  });

  it("il filtro company resta un LIKE %valore% su p.company", () => {
    expect(
      /params\.append\(f"%\{args\.company\}%"\)/.test(positionsFn),
      "in db_query.py il filtro company avvolge il valore in %…%: se là è " +
        "cambiato, POSITIONS_FILTERS.company.param va cambiato con lui",
    ).toBe(true);
    expect(POSITIONS_FILTERS.company.param!("Acme")).toBe("%Acme%");
    expect(
      norm(POSITIONS_FILTERS.company.clause),
      "deve restare p.company e non una ricerca libera su altre colonne",
    ).toBe("AND p.company LIKE ?");
  });
});

describe("l'SQL del dettaglio e della dashboard", () => {
  it("POSITION_DETAIL_SELECT è quello di query_position_detail", () => {
    expect(
      norm(POSITION_DETAIL_SELECT),
      "POSITION_DETAIL_SELECT non corrisponde più a query_position_detail: " +
        "l'insieme delle colonne è il payload di `jht positions show --json`",
    ).toBe(norm(tripleQuoted(detailFn, "query_position_detail")));
    expect(
      /WHERE p\.id = \?/.test(POSITION_DETAIL_SELECT),
      "il dettaglio filtra su p.id e su nient'altro",
    ).toBe(true);
  });

  it("il conteggio per stato è identico, CASE compreso", () => {
    const statuses = /statuses = conn\.execute\("""([\s\S]*?)"""/.exec(dashboardFn);
    expect(statuses, "non trovo la query dei conteggi per stato").toBeTruthy();
    expect(
      norm(DASHBOARD_BY_STATUS),
      "DASHBOARD_BY_STATUS decide sia `total` sia l'ordine di `by_status`",
    ).toBe(norm(statuses![1]));
  });

  it("le quattro query del ramo --json sono identiche", () => {
    const top = /'top_scores': rows_to_dicts\(conn\.execute\("""([\s\S]*?)"""/.exec(
      dashboardJson,
    );
    expect(top, "non trovo la query di top_scores").toBeTruthy();
    expect(
      norm(DASHBOARD_TOP_SCORES),
      "DASHBOARD_TOP_SCORES, LIMIT 10 compreso: il limite è del Python, " +
        "quindi è parità e non una scelta di questa API",
    ).toBe(norm(top![1]));

    const apps = /'applications': rows_to_dicts\(conn\.execute\("""([\s\S]*?)"""/.exec(
      dashboardJson,
    );
    expect(apps, "non trovo la query delle applications").toBeTruthy();
    expect(norm(DASHBOARD_APPLICATIONS)).toBe(norm(apps![1]));

    const verdicts = pySlice(
      dashboardJson,
      "'companies_by_verdict'",
      ".fetchall()",
    );
    expect(
      norm(DASHBOARD_COMPANIES_BY_VERDICT),
      "il Python concatena due letterali adiacenti: se ne aggiunge un terzo, " +
        "questa costante va rifatta",
    ).toBe(norm(joinedLiterals(verdicts, "companies_by_verdict")));

    const withCompany = pySlice(
      dashboardJson,
      "'positions_with_company_id'",
      ".fetchone()",
    );
    expect(norm(DASHBOARD_POSITIONS_WITH_COMPANY_ID)).toBe(
      norm(joinedLiterals(withCompany, "positions_with_company_id")),
    );
  });

  it("le sei chiavi di dashboard --json sono le stesse, in ordine", () => {
    // Le chiavi del dizionario stanno a 12 spazi di indentazione; le chiavi
    // dentro le comprehension (`{r['status']: r['cnt'] …}`) no, ed è per questo
    // che l'ancora è l'inizio di riga e non il solo apostrofo.
    const keys = Array.from(dashboardJson.matchAll(/^ {12}'([a-z_]+)':/gm)).map(
      (m) => m[1],
    );
    expect(
      keys.length,
      "non trovo le chiavi di emit_json in dashboard(): l'indentazione del " +
        "Python è cambiata e questo estrattore va riscritto",
    ).toBe(6);
    expect(
      [...DASHBOARD_KEYS],
      "DASHBOARD_KEYS è il contratto di `jht positions dashboard --json`: " +
        "una chiave in più o in meno è un cambio di payload, che per il " +
        "contratto dell'API vale un bump di API_CONTRACT",
    ).toEqual(keys);
  });
});

describe("il numero di versione dello schema", () => {
  it("EXPECTED_USER_VERSION è il timbro di _db.py", () => {
    const stamps = Array.from(
      dbPython.matchAll(/PRAGMA user_version\s*=\s*(\d+)/g),
    ).map((m) => Number(m[1]));
    expect(
      stamps.length,
      "in shared/skills/_db.py mi aspetto un solo `PRAGMA user_version = N`: " +
        "ne ho trovati " +
        stamps.length,
    ).toBe(1);
    expect(
      EXPECTED_USER_VERSION,
      "il timbro di _db.py è cambiato: aggiorna EXPECTED_USER_VERSION in " +
        "shared/queries/schema-census.js — e ricorda che quel numero è " +
        "INFORMATIVO, non nega mai una risposta (il 503 lo guida il censimento " +
        "strutturale delle colonne)",
    ).toBe(stamps[0]);
  });
});

describe("l'estrattore sa accorgersi di una riscrittura", () => {
  it("su un Python mutato ad arte il confronto cade", () => {
    // Senza questo, una regex che aggancia il pezzo sbagliato (o un `norm`
    // troppo generoso) renderebbe verdi tutti i test qui sopra per sempre.
    const mutated = positionsFn.replace(
      "p.found_at DESC",
      "p.id DESC /* riscrittura finta */",
    );
    expect(
      mutated === positionsFn,
      "la mutazione non ha cambiato niente: il testo di riferimento non è più " +
        "quello che credo, quindi i confronti qui sopra non provano nulla",
    ).toBe(false);
    const appended = Array.from(mutated.matchAll(/query \+= "([^"]*)"/g)).map(
      (m) => m[1],
    );
    expect(norm(appended[5])).not.toBe(norm(POSITIONS_ORDER_BY));
  });
});
