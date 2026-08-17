/**
 * [JHT-TEAM-API-BOUNDARY] Le rotte, contro un `jobs.db` VERO.
 *
 * Il database è costruito qui con `node:sqlite` — zero installazioni, nessuna
 * dipendenza da `web/node_modules` — perché la domanda a cui questo file
 * risponde è di valore, non di forma: `/v1/positions` restituisce un array
 * NUDO? `company=Stripe` filtra sull'azienda e non anche sul titolo? un id
 * inesistente è un 404 e non un 200 con `null` dentro? Sono tutte cose che un
 * backend finto direbbe come vogliamo noi.
 *
 * Nessun socket: il handler è richiesta-dentro/risposta-fuori, e le venti righe
 * di adattatore `node:http` restano dichiaratamente non coperte in
 * `cli/src/lib/api/server.js`.
 *
 * Il `Host` e il Bearer sono provati in `api-handler-auth-host.test.ts`; qui
 * ogni richiesta è già legittima e il soggetto è quello che c'è dopo i
 * cancelli. L'autenticazione resta quella vera comunque: un finto
 * `authenticate` che dicesse sempre `true` nasconderebbe il giorno in cui la
 * pipeline chiama il cancello sbagliato.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createApiHandler } from "../../../cli/src/lib/api/handler.js";
import {
  createReadonlyBackend,
  DASHBOARD_KEYS,
} from "../../../shared/queries/readonly-sqlite.js";
import { EXPECTED_USER_VERSION } from "../../../shared/queries/schema-census.js";

const ORIGINAL_HOME = process.env.JHT_HOME;
const ORIGINAL_DEPLOY = process.env.NEXT_PUBLIC_JHT_DEPLOY;
const ORIGINAL_VERCEL = process.env.VERCEL;

const root = mkdtempSync(path.join(tmpdir(), "jht-api-routes-"));
const home = path.join(root, "home");

/**
 * Lo schema del fixture: le colonne che i due SELECT portati da `db_query.py`
 * nominano per nome. La parità con lo schema vero la tiene il cancello Python
 * (`tests/test_api_read_parity.py`), che costruisce il database con
 * `_db.ensure_schema`; qui serve un database vero, non lo schema vero.
 *
 * I tre annunci sono scelti per una domanda sola: la posizione 2 ha «Stripe»
 * nel TITOLO e un'altra azienda, la 3 ha «Stripe» come AZIENDA. Un filtro
 * `company` che diventasse una ricerca libera le restituirebbe entrambe, e
 * nessun client se ne accorgerebbe guardando il numero di righe.
 */
const FIXTURE_DDL = `
  CREATE TABLE positions (
    id INTEGER PRIMARY KEY, title TEXT, company TEXT, status TEXT, source TEXT,
    found_at TEXT, company_id INTEGER, loc_city TEXT);
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
  INSERT INTO companies (id, name, hq_country, verdict, sector)
    VALUES (1, 'Acme SpA', 'IT', 'GO', 'fintech');
  PRAGMA user_version = ${EXPECTED_USER_VERSION};
`;

type Req = {
  method?: string;
  path?: string;
  headers?: Record<string, unknown>;
  query?: unknown;
  hasBody?: boolean;
};
type Res = { status: number; headers: Record<string, string>; body: string };
type Roster = { tmux: string; sessions: string[] };

let auth: typeof import("../../../cli/src/lib/api/auth.js");
let token = "";

/** Tutti i backend aperti: si chiudono in `afterAll`, o su Windows il file
 * temporaneo resta EBUSY e la cartella non si cancella (misurato). */
const opened: Array<{ close: () => void }> = [];
let roster: Roster = { tmux: "ok", sessions: ["CAPITANO", "SCOUT-1"] };

/** Un `jobs.db` vero in una cartella tutta sua. */
function makeDb(ddl = FIXTURE_DDL): string {
  const dir = mkdtempSync(path.join(root, "db-"));
  const dbPath = path.join(dir, "jobs.db");
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(ddl);
  } finally {
    db.close();
  }
  return dbPath;
}

/** Un handler completo su un database vero. */
function makeStack(dbPath: string) {
  const backend = createReadonlyBackend({ DatabaseSync, dbPath });
  opened.push(backend);
  const handler = createApiHandler({
    backend,
    auth,
    tmux: () => roster,
    meta: { product: "test", startedAt: "2026-08-17T00:00:00.000Z" },
  }) as (req: Req) => Promise<Res>;
  return { backend, handler };
}

beforeAll(async () => {
  process.env.JHT_HOME = home;
  process.env.NEXT_PUBLIC_JHT_DEPLOY = "local";
  delete process.env.VERCEL;
  vi.resetModules();
  auth = await import("../../../cli/src/lib/api/auth.js");
  token = auth.getOrCreate() ?? "";
  expect(
    token,
    "cli/src/lib/api/auth.js getOrCreate() non ha prodotto un token nella JHT_HOME temporanea",
  ).toMatch(/^[a-f0-9]{64}$/);
}, 15_000);

afterAll(() => {
  for (const backend of opened) {
    try {
      backend.close();
    } catch {
      /* già chiuso */
    }
  }
  if (ORIGINAL_HOME === undefined) delete process.env.JHT_HOME;
  else process.env.JHT_HOME = ORIGINAL_HOME;
  if (ORIGINAL_DEPLOY === undefined) delete process.env.NEXT_PUBLIC_JHT_DEPLOY;
  else process.env.NEXT_PUBLIC_JHT_DEPLOY = ORIGINAL_DEPLOY;
  if (ORIGINAL_VERCEL === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = ORIGINAL_VERCEL;
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* la cartella temporanea resta: fastidio, non guasto */
  }
});

/** Intestazioni legittime, con l'header di contratto se serve. */
function head(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    host: "127.0.0.1:9797",
    authorization: `Bearer ${token}`,
    "x-jht-api-contract": "1",
    ...extra,
  };
}

function parse(res: Res): any {
  return JSON.parse(res.body);
}

describe("API del team — l'handshake del contratto", () => {
  it("l'header mancante, malformato o disallineato ha quattro esiti distinti", async () => {
    const { handler } = makeStack(makeDb());
    const rows: Array<[unknown, number, string]> = [
      [undefined, 400, "CONTRACT_HEADER_MISSING"],
      ["", 400, "CONTRACT_HEADER_MISSING"],
      ["abc", 400, "CONTRACT_HEADER_MALFORMED"],
      ["1.0", 400, "CONTRACT_HEADER_MALFORMED"],
      ["01", 400, "CONTRACT_HEADER_MALFORMED"],
      ["2", 409, "SERVER_TOO_OLD"],
      ["99", 409, "SERVER_TOO_OLD"],
      ["0", 426, "CLIENT_TOO_OLD"],
      ["1", 200, ""],
    ];
    for (const [value, status, code] of rows) {
      const headers = head();
      if (value === undefined) delete headers["x-jht-api-contract"];
      else headers["x-jht-api-contract"] = value;
      const res = await handler({ method: "GET", path: "/v1/dashboard", headers });
      expect(
        res.status,
        `cli/src/lib/api/handler.js: X-JHT-Api-Contract=${JSON.stringify(value)} deve dare ` +
          `${status} ${code} — il verdetto viene da contractVerdict in shared/api/contract.js`,
      ).toBe(status);
      if (code) expect(parse(res).code).toBe(code);
    }
  }, 15_000);

  it("le due frasi di disallineamento portano ENTRAMBI gli interi", async () => {
    const { handler } = makeStack(makeDb());
    for (const [value, other] of [
      ["0", "0"],
      ["2", "2"],
    ]) {
      const res = await handler({
        method: "GET",
        path: "/v1/dashboard",
        headers: head({ "x-jht-api-contract": value }),
      });
      const body = parse(res);
      expect(
        body.error,
        "shared/api/contract.js: cli/bin/jht.js stampa solo err.message, quindi un intero che " +
          "non sta nella frase è un intero che l'utente non vede mai",
      ).toContain(other);
      expect(body.error).toContain("1");
    }
  }, 15_000);

  it("/version risponde senza header di contratto: è la rotta che lo spiega", async () => {
    const { handler } = makeStack(makeDb());
    const headers = head();
    delete headers["x-jht-api-contract"];
    const res = await handler({ method: "GET", path: "/version", headers });
    expect(
      res.status,
      "cli/src/lib/api/handler.js pretende l'header di contratto anche su /version: così " +
        "risponderebbe «mi manca l'header» a chi sta chiedendo quale header mandare",
    ).toBe(200);
    const data = parse(res).data;
    expect(data.contract).toBe(1);
    expect(data.routes).toEqual([
      "/v1/team/status",
      "/v1/positions",
      "/v1/positions/{id}",
      "/v1/dashboard",
    ]);
  }, 15_000);
});

describe("API del team — metodo, corpo e rotte sconosciute", () => {
  it("ogni verbo di scrittura è 405 con Allow: GET, HEAD", async () => {
    const { handler } = makeStack(makeDb());
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      const res = await handler({ method, path: "/v1/positions", headers: head() });
      expect(
        res.status,
        `cli/src/lib/api/handler.js ha accettato ${method}: la corsia di scrittura è la fase 3, ` +
          "e in fase 1 ogni verbo diverso da GET/HEAD è 405",
      ).toBe(405);
      expect(res.headers.allow).toBe("GET, HEAD");
      expect(parse(res).code).toBe("METHOD_NOT_ALLOWED");
    }
  }, 15_000);

  it("un corpo, in qualunque forma sia annunciato, è 413", async () => {
    const { handler } = makeStack(makeDb());
    const forms: Array<Record<string, unknown>> = [
      { "content-length": "3" },
      { "transfer-encoding": "chunked" },
    ];
    for (const extra of forms) {
      const res = await handler({ method: "GET", path: "/v1/positions", headers: head(extra) });
      expect(
        res.status,
        `cli/src/lib/api/handler.js ha ignorato un corpo annunciato con ${JSON.stringify(extra)}: ` +
          "nessuna rotta ne legge uno, quindi riceverne uno significa che il client parla di " +
          "un'altra API",
      ).toBe(413);
    }
    const flagged = await handler({
      method: "GET",
      path: "/v1/positions",
      headers: head(),
      hasBody: true,
    });
    expect(flagged.status).toBe(413);
    // `content-length: 0` NON è un corpo: rispondere 413 a chi non ha mandato
    // nulla sarebbe una bugia con un numero dentro.
    const zero = await handler({
      method: "GET",
      path: "/v1/positions",
      headers: head({ "content-length": "0" }),
    });
    expect(
      zero.status,
      "cli/src/lib/api/handler.js legge content-length: 0 come un corpo: è invece un client " +
        "che dichiara di non averne mandato",
    ).toBe(200);
  }, 15_000);

  it("una rotta sconosciuta è 404 e il suggerimento nomina /version", async () => {
    const { handler } = makeStack(makeDb());
    for (const p of ["/nope", "/v1", "/v1/positions/", "/v1/positions/1/extra", "/V1/positions"]) {
      const res = await handler({ method: "GET", path: p, headers: head() });
      expect(
        res.status,
        `cli/src/lib/api/handler.js ha riconosciuto ${p} come rotta: il router si costruisce da ` +
          "ROUTES in shared/api/contract.js e le grafie ammesse sono quelle, una per rotta",
      ).toBe(404);
      expect(parse(res).code).toBe("ROUTE_UNKNOWN");
      expect(
        parse(res).hint,
        "shared/api/contract.js: il hint di ROUTE_UNKNOWN deve nominare /version, che è la sola " +
          "rotta da cui si scopre la superficie",
      ).toContain("/version");
    }
  }, 15_000);
});

describe("API del team — /v1/positions", () => {
  it("restituisce un array NUDO, ordinato come db_query.py", async () => {
    const { handler } = makeStack(makeDb());
    const res = await handler({ method: "GET", path: "/v1/positions", headers: head() });
    expect(res.status).toBe(200);
    const data = parse(res).data;
    expect(
      Array.isArray(data),
      "cli/src/lib/api/handler.js ha incartato le posizioni in un oggetto: il payload deve " +
        "essere identico a `jht positions --json`, cioè un array nudo dentro data",
    ).toBe(true);
    expect(
      data.map((row: any) => row.id),
      "shared/queries/readonly-sqlite.js: l'ordine è ORDER BY COALESCE(s.total_score, 0) DESC, " +
        "p.found_at DESC — 82, 60, poi la posizione senza score",
    ).toEqual([1, 3, 2]);
    expect(data[0].total_score).toBe(82);
    expect(data[0].app_status).toBe("review");
    expect(data[0].c_hq_country).toBe("IT");
  }, 15_000);

  it("company filtra sull'AZIENDA, non sul titolo", async () => {
    const { handler } = makeStack(makeDb());
    const res = await handler({
      method: "GET",
      path: "/v1/positions",
      headers: head(),
      query: { company: "Stripe" },
    });
    expect(res.status).toBe(200);
    const ids = parse(res).data.map((row: any) => row.id);
    expect(
      ids,
      "shared/queries/readonly-sqlite.js: il filtro company è `AND p.company LIKE ?` con %v%, " +
        "NON una ricerca libera su titolo/città/paese — la posizione 2 ha «Stripe» nel titolo e " +
        "non deve comparire",
    ).toEqual([3]);
  }, 15_000);

  it("una chiave di query non prevista è 400, non silenzio", async () => {
    const { handler } = makeStack(makeDb());
    const res = await handler({
      method: "GET",
      path: "/v1/positions",
      headers: head(),
      query: { titolo: "Backend" },
    });
    expect(
      res.status,
      "cli/src/lib/api/handler.js ignora una chiave di query sconosciuta: ignorarla vorrebbe " +
        "dire rispondere a una domanda diversa da quella fatta",
    ).toBe(400);
    expect(parse(res).code).toBe("QUERY_PARAM_UNKNOWN");
  }, 15_000);

  it("minScore/maxScore non interi sono 400", async () => {
    const { handler } = makeStack(makeDb());
    for (const query of [{ minScore: "abc" }, { maxScore: "70.5" }, { minScore: "1e3" }]) {
      const res = await handler({ method: "GET", path: "/v1/positions", headers: head(), query });
      expect(
        res.status,
        `cli/src/lib/api/handler.js accetta ${JSON.stringify(query)}: sul filo un parametro è ` +
          "sempre testo, e la conversione a intero si fa in un posto solo",
      ).toBe(400);
      expect(parse(res).code).toBe("QUERY_PARAM_MALFORMED");
    }
    const ok = await handler({
      method: "GET",
      path: "/v1/positions",
      headers: head(),
      query: { minScore: "70" },
    });
    expect(ok.status).toBe(200);
    expect(parse(ok).data.map((r: any) => r.id)).toEqual([1]);
  }, 15_000);
});

describe("API del team — /v1/positions/{id} e /v1/dashboard", () => {
  it("un id esistente è la riga, uno inesistente è 404 e non 200 con null", async () => {
    const { handler } = makeStack(makeDb());
    const found = await handler({ method: "GET", path: "/v1/positions/2", headers: head() });
    expect(found.status).toBe(200);
    expect(parse(found).data.title).toBe("Stripe Integrations");

    const missing = await handler({ method: "GET", path: "/v1/positions/999", headers: head() });
    expect(
      missing.status,
      "cli/src/lib/api/handler.js risponde 200 con null per una posizione assente: sul filo " +
        "quel caso è 404 POSITION_NOT_FOUND, ed è la corsia --json del CLI a tradurlo in null " +
        "(contratto di db_query.py:212)",
    ).toBe(404);
    expect(parse(missing).code).toBe("POSITION_NOT_FOUND");

    const garbage = await handler({ method: "GET", path: "/v1/positions/abc", headers: head() });
    expect(
      garbage.status,
      "cli/src/lib/api/handler.js: un id che non è un intero è un 400 con un nome, non un 404 — " +
        "il rimedio è riscrivere la richiesta, non cercare un'altra posizione",
    ).toBe(400);
    expect(parse(garbage).code).toBe("QUERY_PARAM_MALFORMED");
  }, 15_000);

  it("/v1/dashboard ha esattamente le sei chiavi di DASHBOARD_KEYS, in ordine", async () => {
    const { handler } = makeStack(makeDb());
    const res = await handler({ method: "GET", path: "/v1/dashboard", headers: head() });
    expect(res.status).toBe(200);
    const data = parse(res).data;
    expect(
      Object.keys(data),
      "shared/queries/readonly-sqlite.js: le chiavi della dashboard sono il contratto " +
        "[JHT-CLI-AGENT-PARITY] con db_query.py:388-409 — non aggiungerne e non riordinarle",
    ).toEqual([...DASHBOARD_KEYS]);
    expect(data.total).toBe(3);
    expect(data.by_status).toEqual({ new: 2, scored: 1 });
    expect(data.positions_with_company_id).toBe(1);
  }, 15_000);
});

describe("API del team — /v1/team/status distingue tre esiti", () => {
  it("ok, no-server e absent non si confondono mai", async () => {
    const { handler } = makeStack(makeDb());

    roster = { tmux: "ok", sessions: ["CAPITANO", "SCOUT-1"] };
    const up = await handler({ method: "GET", path: "/v1/team/status", headers: head() });
    expect(up.status).toBe(200);
    expect(parse(up).data.sessions).toEqual(["CAPITANO", "SCOUT-1"]);
    expect(parse(up).data.source).toBe("tmux");

    roster = { tmux: "no-server", sessions: [] };
    const off = await handler({ method: "GET", path: "/v1/team/status", headers: head() });
    expect(
      off.status,
      "cli/src/lib/api/handler.js: tmux vivo con zero sessioni è un 200 — è una risposta " +
        "autorevole («il team è spento»), non un guasto",
    ).toBe(200);
    expect(parse(off).data.tmux).toBe("no-server");
    expect(parse(off).data.sessions).toEqual([]);

    roster = { tmux: "absent", sessions: [] };
    const broken = await handler({ method: "GET", path: "/v1/team/status", headers: head() });
    expect(
      broken.status,
      "cli/src/lib/api/handler.js ha risposto 200 con una lista vuota per un tmux illeggibile: " +
        "è la bugia che ADR-0009:111-113 vieta — «non ho potuto guardare» è 503 TMUX_UNAVAILABLE",
    ).toBe(503);
    expect(parse(broken).code).toBe("TMUX_UNAVAILABLE");

    roster = { tmux: "ok", sessions: ["CAPITANO", "SCOUT-1"] };
  }, 15_000);

  it("è l'unica rotta che risponde con il database assente", async () => {
    const dbPath = makeDb();
    const { backend, handler } = makeStack(dbPath);
    // Su Windows un handle aperto rende il file impossibile da cancellare
    // (EBUSY, misurato): la chiusura non è igiene, è la condizione perché la
    // riga seguente funzioni.
    backend.close();
    unlinkSync(dbPath);

    const res = await handler({ method: "GET", path: "/v1/team/status", headers: head() });
    expect(
      res.status,
      "cli/src/lib/api/handler.js ha legato /v1/team/status al database: è la sola rotta " +
        "senza database, ed è quella con cui la fase 2 misurerà il tunnel",
    ).toBe(200);
  }, 15_000);
});

describe("API del team — il database che non c'è", () => {
  it("le rotte dati sono 503 DB_UNAVAILABLE, /version risponde comunque 200", async () => {
    const dbPath = makeDb();
    const { backend, handler } = makeStack(dbPath);
    backend.close();
    unlinkSync(dbPath);

    for (const p of ["/v1/positions", "/v1/positions/1", "/v1/dashboard"]) {
      const res = await handler({ method: "GET", path: p, headers: head() });
      expect(
        res.status,
        `cli/src/lib/api/handler.js: con jobs.db assente ${p} deve essere 503 DB_UNAVAILABLE ` +
          "(«avvia il team una volta»), non un 500 e non un 200 vuoto",
      ).toBe(503);
      expect(parse(res).code).toBe("DB_UNAVAILABLE");
    }

    const version = await handler({ method: "GET", path: "/version", headers: head() });
    expect(
      version.status,
      "cli/src/lib/api/handler.js: /version deve rispondere 200 anche senza database — è la " +
        "rotta da cui si scopre che il database non c'è",
    ).toBe(200);
    const data = parse(version).data;
    expect(data.db.present).toBe(false);
    expect(
      data.schema.missing,
      "cli/src/lib/api/handler.js: `missing: []` su un database inesistente direbbe «schema " +
        "completo» — le quattro tabelle mancano tutte (allTablesMissing di schema-census.js)",
    ).toEqual(["positions", "scores", "applications", "companies"]);
  }, 15_000);
});
