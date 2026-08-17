/**
 * #186 × #187 — l'esito di una candidatura deve sopravvivere al giro completo.
 *
 * I due lavori sono corretti separatamente e si rompono nell'incontro. #187 dà
 * all'utente i pulsanti per dire com'è andata: sul cloud lo stato diventa
 * `response`. #186 porta a casa le candidature decise sul web, ma la corsia
 * che scende non sa niente dell'esito — `pull-desired-state` non seleziona
 * `response`/`response_at` — e `applyAppliedBackflow` ignora lo `status` che
 * pure gli arriva.
 *
 * ⚠️ LA SEQUENZA CONTA, ed è quella misurata sul campo: PULL PRIMA, CLICK
 * DOPO. Prima il pull scrive `applied` su una posizione che in locale non era
 * candidata; poi l'utente registra l'esito sul sito. Al pull successivo il box
 * è già `applied`, quindi la decisione salta con `already_applied` e l'esito
 * non scende MAI. Un test che clicca prima e pulla dopo prende un difetto
 * diverso e più lieve, e questa divergenza non la vede.
 *
 * Questi test sono scritti PRIMA della correzione (che è di fullstack-3):
 * dicono cosa deve valere, non cosa succede oggi. Finché il difetto è aperto
 * restano marcati `it.fails` — la forma onesta di «misurato rosso, e lo
 * sappiamo». Quando la correzione entra diventano verdi e il marcatore li fa
 * fallire, chiedendo di toglierlo. Un test che descrivesse il comportamento di
 * oggi lo cementerebbe invece di misurarlo.
 *
 * Il terzo anello — se la cancellazione risalga fino al cloud — non si misura
 * qui: sta in `tests/test_response_downgrade_cloud_postgres.py`, dove c'è un
 * PostgreSQL vero con i trigger veri.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";

import { applyAppliedBackflow } from "../../../cli/src/lib/applied-backflow.js";

const dirs: string[] = [];
let previousHome: string | undefined;

/** La fotografia del cloud subito dopo il click «mi sono candidato». */
const DOPO_LA_CANDIDATURA = {
  legacy_id: 7,
  applied: true,
  applied_at: "2026-08-16T09:30:00+00:00",
  applied_via: "user_manual",
  status: "applied",
};

/**
 * La stessa riga dopo che l'utente ha registrato l'esito sul sito.
 *
 * Quando questo file è nato, `pull-desired-state` mandava giù `status` e NON
 * `response`: il box non poteva sapere COSA fosse arrivato, solo che qualcosa
 * era cambiato. Da 6517d125e la select porta anche l'esito e il suo istante,
 * quindi la fotografia qui sotto è quella che il server produce ADESSO — se
 * tornasse quella di prima, questi test tornerebbero rossi, che è il modo in
 * cui devono accorgersene.
 */
const DOPO_L_ESITO = {
  ...DOPO_LA_CANDIDATURA,
  status: "response",
  response: "rejected",
  response_at: "2026-08-17T16:03:34.265+00:00",
};

const SCHEMA = `
  CREATE TABLE positions (
    id INTEGER PRIMARY KEY, title TEXT, company TEXT, company_id INTEGER,
    url TEXT, location TEXT, remote_type TEXT, status TEXT, notes TEXT,
    source TEXT, jd_text TEXT, jd_summary TEXT, requirements TEXT,
    found_by TEXT, found_at TEXT, deadline TEXT, last_checked TEXT,
    last_actor TEXT, salary_declared_min INTEGER, salary_declared_max INTEGER,
    salary_declared_currency TEXT, salary_estimated_min INTEGER,
    salary_estimated_max INTEGER, salary_estimated_currency TEXT,
    salary_estimated_source TEXT, write_requested INTEGER,
    write_requested_at TEXT, geocode_requested INTEGER,
    geocode_requested_at TEXT, recheck_requested INTEGER,
    recheck_requested_at TEXT, salary_precise_requested INTEGER,
    salary_precise_requested_at TEXT, salary_precise TEXT, role_family TEXT,
    loc_city TEXT, loc_region TEXT, loc_country TEXT, loc_country_code TEXT,
    loc_continent TEXT, work_mode TEXT, work_country TEXT,
    work_country_code TEXT, location_notes TEXT, is_multi_location INTEGER,
    office_lat REAL, office_lon REAL, office_address TEXT,
    office_geocoded INTEGER, office_verified INTEGER, expires_at TEXT,
    is_open INTEGER, last_open_check TEXT, created_at TEXT, updated_at TEXT
  );
  CREATE TABLE applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT, position_id INTEGER UNIQUE,
    cv_path TEXT, cv_pdf_path TEXT, cl_path TEXT, cl_pdf_path TEXT,
    status TEXT, critic_score REAL, critic_verdict TEXT, critic_notes TEXT,
    critic_round INTEGER, written_at TEXT, applied_at TEXT, applied_via TEXT,
    response TEXT, response_at TEXT, written_by TEXT, reviewed_by TEXT,
    critic_reviewed_at TEXT, applied INTEGER, cv_drive_id TEXT,
    cl_drive_id TEXT, created_at TEXT, updated_at TEXT
  );
  CREATE TABLE scores (
    id INTEGER PRIMARY KEY, position_id INTEGER, total_score INTEGER,
    experience_fit INTEGER, salary_fit INTEGER, stack_match INTEGER,
    remote_fit INTEGER, strategic_fit INTEGER, breakdown TEXT, notes TEXT,
    scored_by TEXT, scored_at TEXT, updated_at TEXT
  );
  -- Copiata da shared/skills/_db.py: ts ha il DEFAULT, e senza quello il push
  -- aborta per identità mancante — un rosso del fixture che sembra un difetto
  -- del prodotto.
  CREATE TABLE position_state_transitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, position_id INTEGER NOT NULL,
    from_state TEXT, to_state TEXT NOT NULL,
    ts TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    by_agent TEXT NOT NULL, notes TEXT
  );
`;

/** Il box PRIMA del pull: la posizione c'è, la candidatura no. */
const RIGHE = `
  INSERT INTO positions (id, title, company, status, updated_at)
    VALUES (7, 'Synthetic role', 'Synthetic company', 'ready',
            '2026-08-15 09:00:00');
`;

function box() {
  previousHome = process.env.JHT_HOME;
  const home = mkdtempSync(join(tmpdir(), "jht-response-outcome-"));
  dirs.push(home);
  process.env.JHT_HOME = home;
  writeFileSync(
    join(home, "cloud.json"),
    JSON.stringify({
      enabled: true,
      base_url: "https://cloud.example.test",
      token: "jht_sync_synthetic-test-token",
    }),
  );
  const dbPath = join(home, "jobs.db");
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA + RIGHE);
  db.close();
  return { home, dbPath };
}

/** Un tick della corsia che scende, col codice vero del daemon. */
function pull(dbPath: string, fotografia: Record<string, unknown>) {
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  const esito = applyAppliedBackflow(db, [fotografia]);
  db.close();
  return esito;
}

function stato(dbPath: string) {
  const db = new DatabaseSync(dbPath);
  const riga = db
    .prepare(
      "SELECT p.status AS posizione, a.status AS candidatura, " +
        "a.response AS esito FROM positions p " +
        "LEFT JOIN applications a ON a.position_id = p.id WHERE p.id = 7",
    )
    .get() as Record<string, unknown>;
  db.close();
  return riga;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
  process.exitCode = undefined;
  if (previousHome === undefined) delete process.env.JHT_HOME;
  else process.env.JHT_HOME = previousHome;
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("pull prima, click dopo — l'esito deve arrivare al box", () => {
  it("il primo pull porta a casa la candidatura decisa sul web", () => {
    // Questo anello funziona, ed è il motivo per cui il difetto è invisibile
    // finché non si guarda il secondo giro.
    const { dbPath } = box();

    expect(pull(dbPath, DOPO_LA_CANDIDATURA)).toMatchObject({ applied: 1 });

    expect(stato(dbPath)).toMatchObject({
      posizione: "applied",
      candidatura: "applied",
      esito: null,
    });
  });

  it("il pull successivo porta a casa anche l'esito registrato", () => {
    const { dbPath } = box();
    pull(dbPath, DOPO_LA_CANDIDATURA);

    // L'utente clicca «rifiutata» sul sito: sul cloud la riga diventa
    // `response`. Il box è già `applied`, quindi la decisione salta con
    // `already_applied` e l'esito non scende mai — i due lati restano
    // divergenti finché qualcuno non guarda.
    pull(dbPath, DOPO_L_ESITO);

    expect(stato(dbPath)).toMatchObject({
      posizione: "response",
      candidatura: "response",
    });
  });

  it(
    "il push non rimanda su uno stato più vecchio dell'esito",
    async () => {
      const { dbPath } = box();
      pull(dbPath, DOPO_LA_CANDIDATURA);
      pull(dbPath, DOPO_L_ESITO);

      const posizioni: Array<Record<string, unknown>> = [];
      const candidature: Array<Record<string, unknown>> = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: unknown, init?: RequestInit) => {
          const body = JSON.parse(String(init?.body || "{}"));
          const table = Object.keys(body)[0];
          const rows = body[table] as Array<Record<string, unknown>>;
          if (table === "positions") posizioni.push(...rows);
          if (table === "applications") candidature.push(...rows);
          return new Response(
            JSON.stringify({
              receipts: { [table]: rows.map((row) => row._receipt_id) },
              [table]: { upserted: rows.length },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }),
      );
      vi.spyOn(console, "log").mockImplementation(() => {});
      vi.resetModules();
      const { handlePush } = await import("../../../cli/src/commands/cloud.js");

      await handlePush({ db: dbPath, full: true });
      process.stdout.write(
        "MISURA-CANDIDATURE " +
          JSON.stringify(
            candidature.map((r) => ({
              legacy_id: r.position_legacy_id,
              status: r.status,
              response: r.response,
              applied: r.applied,
            })),
          ) +
          "\n",
      );

      // Il terzo anello parte da qui: il box rimanda `applied` e una
      // candidatura con `response` vuota. Che poi il cloud accetti davvero
      // quella cancellazione lo misura il test PostgreSQL.
      expect(posizioni.find((row) => row.legacy_id === 7)?.status).not.toBe(
        "applied",
      );
      expect(
        candidature.find((row) => row.position_legacy_id === 7),
      ).not.toMatchObject({ response: null, status: "applied" });
    },
  );
});
