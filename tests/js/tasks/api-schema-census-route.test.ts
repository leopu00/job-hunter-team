/**
 * [JHT-TEAM-API-BOUNDARY] Il censimento dello schema, visto dal filo.
 *
 * Questo file inchioda una decisione che è facile prendere al rovescio, e che
 * al rovescio spegnerebbe l'API su installazioni sane:
 *
 *   · **il NUMERO di versione dello schema è informativo.** `_db.py:849` timbra
 *     `PRAGMA user_version = 7` mentre il docstring della stessa funzione
 *     documenta già una migrazione v7→v8 (`_db.py:122-127`): il timbro e la
 *     storia delle migrazioni sono in disaccordo nel repo, oggi. E solo il
 *     percorso Python migra, come EFFETTO COLLATERALE della lettura: una
 *     macchina che ha scaricato un'immagine nuova e non ha ancora avviato il
 *     team è legittimamente indietro di una migrazione, con tutte le colonne
 *     che servono già al loro posto. Un 503 su `user_version != 7` sarebbe
 *     quindi un guasto inventato;
 *   · **la STRUTTURA no.** Una tabella o una colonna che le rotte leggono e che
 *     non c'è è un 503 `DB_SCHEMA_INCOMPLETE`, con l'elenco di quello che
 *     manca, invece di un 500 o — peggio — di una risposta assottigliata che
 *     assomiglia a un dato.
 *
 * Le due asserzioni si tengono insieme: senza la prima l'API nega servizio a
 * chi sta bene, senza la seconda serve dati a metà a chi sta male.
 *
 * Nessun socket, e ogni handle si chiude in `afterAll`: su Windows un handle
 * aperto rende il file temporaneo impossibile da cancellare (EBUSY, misurato).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createApiHandler } from "../../../cli/src/lib/api/handler.js";
import { createReadonlyBackend } from "../../../shared/queries/readonly-sqlite.js";
import {
  EXPECTED_USER_VERSION,
  REQUIRED_TABLES,
} from "../../../shared/queries/schema-census.js";

const ORIGINAL_HOME = process.env.JHT_HOME;
const ORIGINAL_DEPLOY = process.env.NEXT_PUBLIC_JHT_DEPLOY;
const ORIGINAL_VERCEL = process.env.VERCEL;

const root = mkdtempSync(path.join(tmpdir(), "jht-api-census-"));
const home = path.join(root, "home");

/** Le colonne che il censimento pretende su `positions`, tutte presenti. */
const POSITIONS_FULL = `CREATE TABLE positions (
    id INTEGER PRIMARY KEY, title TEXT, company TEXT, status TEXT, source TEXT,
    found_at TEXT, company_id INTEGER);`;

/** Lo stesso, senza `found_at`: una colonna che l'ORDER BY legge per nome. */
const POSITIONS_WITHOUT_FOUND_AT = `CREATE TABLE positions (
    id INTEGER PRIMARY KEY, title TEXT, company TEXT, status TEXT, source TEXT,
    company_id INTEGER);`;

const OTHER_TABLES = `
  CREATE TABLE scores (
    id INTEGER PRIMARY KEY, position_id INTEGER, total_score INTEGER,
    stack_match INTEGER, remote_fit INTEGER, salary_fit INTEGER,
    experience_fit INTEGER, strategic_fit INTEGER, breakdown TEXT, notes TEXT);
  CREATE TABLE applications (
    id INTEGER PRIMARY KEY, position_id INTEGER, status TEXT, critic_verdict TEXT,
    applied_at TEXT, written_at TEXT, cv_path TEXT, cl_path TEXT, cv_pdf_path TEXT,
    cl_pdf_path TEXT, critic_score INTEGER, critic_notes TEXT, applied_via TEXT,
    response TEXT, response_at TEXT);
`;

const COMPANIES = `CREATE TABLE companies (
    id INTEGER PRIMARY KEY, name TEXT, hq_country TEXT, verdict TEXT, sector TEXT);`;

const SEED = `
  INSERT INTO positions (id, title, company, status, source, company_id)
    VALUES (1, 'Backend Engineer', 'Acme SpA', 'scored', 'linkedin', 1);
  INSERT INTO scores (position_id, total_score) VALUES (1, 82);
`;

type Req = {
  method?: string;
  path?: string;
  headers?: Record<string, unknown>;
  query?: unknown;
};
type Res = { status: number; headers: Record<string, string>; body: string };

let auth: typeof import("../../../cli/src/lib/api/auth.js");
let token = "";
const opened: Array<{ close: () => void }> = [];

const DATA_ROUTES = ["/v1/positions", "/v1/positions/1", "/v1/dashboard"];

/**
 * Un database su misura: quali tabelle, con quale timbro di versione.
 *
 * `userVersion` viaggia come numero interpolato in un `PRAGMA` perché un PRAGMA
 * non accetta parametri legati; il valore arriva solo da questo file.
 */
function makeDb(opts: { positions: string; companies: boolean; userVersion: number }): string {
  const dir = mkdtempSync(path.join(root, "db-"));
  const dbPath = path.join(dir, "jobs.db");
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(opts.positions);
    db.exec(OTHER_TABLES);
    if (opts.companies) db.exec(COMPANIES);
    // Le righe si seminano solo quando `positions` ha tutte le colonne: la
    // variante senza `found_at` serve al censimento, non ai dati.
    if (opts.positions === POSITIONS_FULL) db.exec(SEED);
    db.exec(`PRAGMA user_version = ${opts.userVersion}`);
  } finally {
    db.close();
  }
  return dbPath;
}

function makeStack(dbPath: string) {
  const backend = createReadonlyBackend({ DatabaseSync, dbPath });
  opened.push(backend);
  const handler = createApiHandler({
    backend,
    auth,
    tmux: () => ({ tmux: "ok" as const, sessions: [] as string[] }),
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

describe("API del team — un timbro di versione diverso NON nega servizio", () => {
  it("user_version 3 con tutte le colonne: /version lo dice e le rotte servono", async () => {
    const dbPath = makeDb({ positions: POSITIONS_FULL, companies: true, userVersion: 3 });
    const { handler } = makeStack(dbPath);

    const version = await handler({ method: "GET", path: "/version", headers: head() });
    expect(version.status).toBe(200);
    const schema = parse(version).data.schema;
    expect(
      schema.userVersion,
      "cli/src/lib/api/handler.js: /version deve RIPORTARE il timbro trovato, non correggerlo",
    ).toBe(3);
    expect(
      schema.expected,
      "shared/queries/schema-census.js: EXPECTED_USER_VERSION è una copia di _db.py:849 e va " +
        "pubblicata accanto al valore trovato, così un client vede la deriva",
    ).toBe(EXPECTED_USER_VERSION);
    expect(
      schema.missing,
      "shared/queries/schema-census.js: con tutte le tabelle e le colonne al loro posto il " +
        "censimento è vuoto — il numero di versione non c'entra con la completezza",
    ).toEqual([]);

    for (const p of DATA_ROUTES) {
      const res = await handler({ method: "GET", path: p, headers: head() });
      expect(
        res.status,
        `cli/src/lib/api/handler.js: ${p} ha risposto ${res.status} su un database indietro di ` +
          "migrazioni ma STRUTTURALMENTE completo. Questa è la regressione di disponibilità che " +
          "il piano vieta: solo il percorso Python migra, e lo fa leggendo — una macchina che " +
          "non ha ancora avviato il team è legittimamente indietro",
      ).toBe(200);
    }
  }, 15_000);

  it("un timbro assente (database mai marchiato) resta servibile", async () => {
    const dbPath = makeDb({ positions: POSITIONS_FULL, companies: true, userVersion: 0 });
    const { handler } = makeStack(dbPath);
    const version = await handler({ method: "GET", path: "/version", headers: head() });
    expect(parse(version).data.schema.userVersion).toBe(0);
    const res = await handler({ method: "GET", path: "/v1/dashboard", headers: head() });
    expect(
      res.status,
      "cli/src/lib/api/handler.js: un database con user_version 0 (mai marchiato) ma completo " +
        "deve servire — il 503 è riservato a quello che manca davvero",
    ).toBe(200);
  }, 15_000);
});

describe("API del team — una tabella o una colonna che manca È un 503", () => {
  it("senza la tabella companies le rotte dati sono 503 DB_SCHEMA_INCOMPLETE", async () => {
    const dbPath = makeDb({
      positions: POSITIONS_FULL,
      companies: false,
      userVersion: EXPECTED_USER_VERSION,
    });
    const { handler } = makeStack(dbPath);

    for (const p of DATA_ROUTES) {
      const res = await handler({ method: "GET", path: p, headers: head() });
      expect(
        res.status,
        `cli/src/lib/api/handler.js: ${p} su un database senza la tabella companies deve essere ` +
          "503 DB_SCHEMA_INCOMPLETE — i quattro LEFT JOIN di POSITIONS_SELECT la nominano",
      ).toBe(503);
      expect(parse(res).code).toBe("DB_SCHEMA_INCOMPLETE");
      expect(
        parse(res).error,
        "cli/src/lib/api/handler.js: la frase del 503 deve NOMINARE quello che manca, altrimenti " +
          "chi la legge non sa cosa aggiustare",
      ).toContain("companies");
    }

    const version = await handler({ method: "GET", path: "/version", headers: head() });
    expect(
      version.status,
      "cli/src/lib/api/handler.js: /version risponde 200 anche con lo schema incompleto — è la " +
        "rotta da cui si legge schema.missing",
    ).toBe(200);
    expect(parse(version).data.schema.missing).toEqual(["companies"]);
  }, 15_000);

  it("una COLONNA che manca si legge come tabella.colonna e vale un 503", async () => {
    const dbPath = makeDb({
      positions: POSITIONS_WITHOUT_FOUND_AT,
      companies: true,
      userVersion: EXPECTED_USER_VERSION,
    });
    const { handler } = makeStack(dbPath);

    const version = await handler({ method: "GET", path: "/version", headers: head() });
    expect(
      parse(version).data.schema.missing,
      "shared/queries/schema-census.js: le due forme di `missing` (tabella, tabella.colonna) " +
        "sono quello che distingue «non c'è niente» da «manca una colonna»",
    ).toEqual(["positions.found_at"]);

    const res = await handler({ method: "GET", path: "/v1/positions", headers: head() });
    expect(
      res.status,
      "cli/src/lib/api/handler.js: senza positions.found_at l'ORDER BY di POSITIONS_ORDER_BY " +
        "non si può eseguire — deve essere un 503 con un nome, non un 500",
    ).toBe(503);
    expect(parse(res).code).toBe("DB_SCHEMA_INCOMPLETE");
    expect(parse(res).error).toContain("positions.found_at");
  }, 15_000);

  it("/v1/team/status non guarda il database e risponde comunque", async () => {
    const dbPath = makeDb({
      positions: POSITIONS_WITHOUT_FOUND_AT,
      companies: false,
      userVersion: 1,
    });
    const { handler } = makeStack(dbPath);
    const res = await handler({ method: "GET", path: "/v1/team/status", headers: head() });
    expect(
      res.status,
      "cli/src/lib/api/handler.js ha legato /v1/team/status al censimento dello schema: quella " +
        "rotta non tocca il database, ed è l'unica cosa che risponde quando il resto non può",
    ).toBe(200);
  }, 15_000);

  it("il censimento copre tutte e quattro le tabelle che le rotte nominano", () => {
    expect(
      [...REQUIRED_TABLES],
      "shared/queries/schema-census.js: le tabelle censite sono quelle dei quattro LEFT JOIN " +
        "portati da db_query.py — se ne aggiungi una all'SQL, aggiungila anche qui",
    ).toEqual(["positions", "scores", "applications", "companies"]);
  });
});
