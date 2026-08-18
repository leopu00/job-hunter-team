/**
 * Test — cli/src/commands/cloud.js::handleRestore (vitest)
 *
 * [DEDUP-URL-CORRECTNESS] — residuo dichiarato in BACKLOG, chiuso con T-027.
 * Il restore (disaster recovery) applicava lo snapshot cloud con
 * INSERT OR REPLACE: con l'indice UNIQUE parziale su `url`, OR REPLACE
 * risolve un conflitto di URL CANCELLANDO la riga locale che possiede già
 * quell'URL — e il trigger `positions_tombstone` propagherebbe la delete al
 * cloud. Perdita silenziosa proprio nel percorso che deve ricostruire i dati.
 *
 * Cosa proteggono questi test: il restore non cancella MAI per risolvere un
 * conflitto di URL — la riga cloud in conflitto viene saltata e dichiarata a
 * video, con conteggio nel report. I DB dei test hanno indice UNIQUE e
 * trigger tombstone VERI, così un eventuale DELETE lascerebbe traccia in
 * `_tombstones` e il test lo vedrebbe.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const sqliteTestState = vi.hoisted(() => ({ recursiveTriggers: false }));

vi.mock("node:sqlite", async (importOriginal) => {
  const { DatabaseSync: NativeDatabaseSync } = await importOriginal<typeof import("node:sqlite")>();
  return {
    DatabaseSync: class TestDatabaseSync extends NativeDatabaseSync {
      constructor(...args: ConstructorParameters<typeof NativeDatabaseSync>) {
        super(...args);
        if (sqliteTestState.recursiveTriggers) {
          // #195: il REPLACE precedente attiverebbe scores_tombstone solo con
          // questo pragma. Vale per ogni connessione, incluso handleRestore.
          // La fixture non monta scores_touch_updated_at: qui ricorrerebbe se
          // CURRENT_TIMESTAMP restasse nello stesso secondo.
          this.exec("PRAGMA recursive_triggers = ON");
        }
      }
    },
  };
});

type CloudModule = typeof import("../../../cli/src/commands/cloud.js");

const URL_X = "https://boards.example/jobs/42";

let home: string;
let dbPath: string;
let originalJhtHome: string | undefined;

function writeCloudConfig() {
  mkdirSync(home, { recursive: true });
  writeFileSync(
    join(home, "cloud.json"),
    JSON.stringify({
      enabled: true,
      base_url: "https://cloud.example.test/",
      token: "jht_sync_restore-token",
      token_name: "laptop-restore",
    }),
  );
}

/** Schema minimo ma fedele: indice UNIQUE parziale e trigger tombstone VERI. */
function createLocalDb() {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE positions (
      id INTEGER PRIMARY KEY,
      title TEXT, company TEXT, company_id INTEGER,
      location TEXT, remote_type TEXT,
      salary_declared_min INTEGER, salary_declared_max INTEGER, salary_declared_currency TEXT,
      salary_estimated_min INTEGER, salary_estimated_max INTEGER, salary_estimated_currency TEXT,
      salary_estimated_source TEXT,
      url TEXT, source TEXT, jd_text TEXT, jd_summary TEXT, requirements TEXT,
      found_by TEXT, found_at TEXT, deadline TEXT,
      status TEXT, notes TEXT, last_checked TEXT, last_actor TEXT, role_family TEXT,
      loc_city TEXT, loc_region TEXT, loc_country TEXT, loc_country_code TEXT,
      work_country TEXT, work_country_code TEXT,
      is_multi_location INTEGER, location_notes TEXT,
      office_lat REAL, office_lon REAL, office_address TEXT,
      office_geocoded INTEGER, office_verified INTEGER,
      write_requested INTEGER, write_requested_at TEXT,
      geocode_requested INTEGER, geocode_requested_at TEXT,
      created_at TEXT, updated_at TEXT
    );
    CREATE UNIQUE INDEX idx_positions_url_unique
      ON positions(url) WHERE url IS NOT NULL AND url <> '';
    CREATE TABLE scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      position_id INTEGER NOT NULL UNIQUE, total_score INTEGER,
      experience_fit INTEGER, salary_fit INTEGER, stack_match INTEGER,
      remote_fit INTEGER, strategic_fit INTEGER, breakdown TEXT, notes TEXT,
      scored_by TEXT, scored_at TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE applications (
      position_id INTEGER PRIMARY KEY, cv_path TEXT, cv_pdf_path TEXT,
      cl_path TEXT, cl_pdf_path TEXT, status TEXT, critic_score REAL,
      critic_verdict TEXT, critic_notes TEXT, written_at TEXT, applied_at TEXT,
      applied_via TEXT, response TEXT, response_at TEXT, written_by TEXT,
      reviewed_by TEXT, critic_reviewed_at TEXT, applied INTEGER,
      cv_drive_id TEXT, cl_drive_id TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE _tombstones (
      table_name TEXT NOT NULL, legacy_id INTEGER NOT NULL,
      deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (table_name, legacy_id)
    );
    CREATE TRIGGER positions_tombstone BEFORE DELETE ON positions FOR EACH ROW
    BEGIN
      INSERT OR REPLACE INTO _tombstones (table_name, legacy_id, deleted_at)
      VALUES ('positions', OLD.id, CURRENT_TIMESTAMP);
    END;
    CREATE TRIGGER scores_tombstone BEFORE DELETE ON scores FOR EACH ROW
    BEGIN
      INSERT OR REPLACE INTO _tombstones (table_name, legacy_id, deleted_at)
      VALUES ('scores', OLD.position_id, CURRENT_TIMESTAMP);
    END;
  `);
  db.close();
}

function insertLocalPosition(id: number, title: string, url: string | null) {
  const db = new DatabaseSync(dbPath);
  db.prepare("INSERT INTO positions (id, title, company, url) VALUES (?, ?, ?, ?)")
    .run(id, title, "Acme", url);
  db.close();
}

function tableRows(sql: string): unknown[] {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const rows = db.prepare(sql).all();
  db.close();
  return rows;
}

function dumpWith(
  positions: Record<string, unknown>[],
  scores: Record<string, unknown>[] = [],
) {
  return new Response(
    JSON.stringify({ dump: { positions, scores, applications: [] } }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function outputOf(spy: ReturnType<typeof vi.spyOn>) {
  return spy.mock.calls.map((args) => args.map(String).join(" ")).join("\n");
}

async function loadCloud(): Promise<CloudModule> {
  vi.resetModules();
  return import("../../../cli/src/commands/cloud.js");
}

async function runRestore(
  dumpPositions: Record<string, unknown>[],
  dumpScores: Record<string, unknown>[] = [],
) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(dumpWith(dumpPositions, dumpScores)));
  const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
  const { handleRestore } = await loadCloud();
  await handleRestore({ confirmRestore: true, db: dbPath });
  return outputOf(stdout);
}

beforeEach(() => {
  originalJhtHome = process.env.JHT_HOME;
  home = mkdtempSync(join(tmpdir(), "jht-cloud-restore-"));
  process.env.JHT_HOME = home;
  dbPath = join(home, "jobs.db");
  process.exitCode = undefined;
  writeCloudConfig();
  createLocalDb();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
  rmSync(home, { recursive: true, force: true });
  if (originalJhtHome === undefined) delete process.env.JHT_HOME;
  else process.env.JHT_HOME = originalJhtHome;
  process.exitCode = undefined;
  sqliteTestState.recursiveTriggers = false;
});

describe("jht cloud restore — conflitti di URL (T-027)", () => {
  it("URL già posseduto da un'altra riga locale: la cloud è SALTATA, nessun DELETE", async () => {
    insertLocalPosition(5, "Local original", URL_X);
    const out = await runRestore([
      { id: "uuid-a", legacy_id: 7, title: "Cloud copy", company: "Acme", url: URL_X },
    ]);

    const positions = tableRows("SELECT id, title FROM positions ORDER BY id") as {
      id: number; title: string;
    }[];
    expect(positions).toEqual([{ id: 5, title: "Local original" }]);
    expect(tableRows("SELECT * FROM _tombstones")).toEqual([]);
    expect(out).toContain("URL conflicts: 1 cloud row(s) SKIPPED");
    expect(out).toContain("local id 5");
    expect(out).toContain("Positions:    0 upserted");
    expect(process.exitCode).toBeUndefined();
  });

  it("stesso URL e stesso id: replace normale su PK, nessun conflitto dichiarato", async () => {
    insertLocalPosition(7, "Old title", URL_X);
    const out = await runRestore([
      { id: "uuid-a", legacy_id: 7, title: "New title", company: "Acme", url: URL_X },
    ]);

    const positions = tableRows("SELECT id, title FROM positions") as {
      id: number; title: string;
    }[];
    expect(positions).toEqual([{ id: 7, title: "New title" }]);
    expect(tableRows("SELECT * FROM _tombstones")).toEqual([]);
    expect(out).not.toContain("cloud row(s) SKIPPED");
    expect(out).toContain("Positions:    1 upserted");
  });

  it("URL diverso: upsert normale, nessun conflitto", async () => {
    insertLocalPosition(5, "Local original", URL_X);
    const out = await runRestore([
      { id: "uuid-b", legacy_id: 9, title: "Other job", company: "Beta",
        url: "https://boards.example/jobs/99" },
    ]);

    expect(tableRows("SELECT id FROM positions ORDER BY id").map((r) => (r as { id: number }).id))
      .toEqual([5, 9]);
    expect(out).not.toContain("cloud row(s) SKIPPED");
  });

  it("due righe cloud con lo stesso URL: la seconda è saltata, nessun tombstone", async () => {
    const out = await runRestore([
      { id: "uuid-a", legacy_id: 7, title: "First copy", company: "Acme", url: URL_X },
      { id: "uuid-b", legacy_id: 9, title: "Second copy", company: "Acme", url: URL_X },
    ]);

    const positions = tableRows("SELECT id, title FROM positions") as {
      id: number; title: string;
    }[];
    expect(positions).toEqual([{ id: 7, title: "First copy" }]);
    expect(tableRows("SELECT * FROM _tombstones")).toEqual([]);
    expect(out).toContain("URL conflicts: 1 cloud row(s) SKIPPED");
  });

  it("ripristina due volte lo score della stessa posizione senza cambiarne identità", async () => {
    sqliteTestState.recursiveTriggers = true;
    const position = {
      id: "uuid-score-position", legacy_id: 23,
      title: "Cloud score", company: "Acme", url: "https://boards.example/jobs/23",
    };
    await runRestore([position], [{
      position_id: position.id, total_score: 61, scored_by: "scorer",
    }]);
    const first = tableRows(
      "SELECT id, total_score FROM scores WHERE position_id = 23",
    ) as { id: number; total_score: number }[];

    const local = new DatabaseSync(dbPath);
    local.prepare(
      "UPDATE scores SET created_at = ?, updated_at = ? WHERE position_id = ?",
    ).run("2000-01-01 00:00:00", "2000-01-01 00:00:00", 23);
    local.close();

    await runRestore([position], [{
      position_id: position.id, total_score: 79, scored_by: "scorer",
    }]);
    const second = tableRows(
      "SELECT id, total_score, created_at, updated_at FROM scores WHERE position_id = 23",
    ) as {
      id: number; total_score: number; created_at: string | null; updated_at: string | null;
    }[];

    expect(first).toHaveLength(1);
    expect(second[0]).toMatchObject({
      id: first[0].id,
      total_score: 79,
      created_at: "2000-01-01 00:00:00",
    });
    expect(second[0].updated_at).not.toBe("2000-01-01 00:00:00");
    expect(second[0].updated_at).not.toBeNull();
    expect(tableRows(
      "SELECT legacy_id FROM _tombstones WHERE table_name = 'scores'",
    )).toEqual([]);
  });
});
