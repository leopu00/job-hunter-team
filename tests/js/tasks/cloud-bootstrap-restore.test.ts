/**
 * Test — cli/src/lib/bootstrap-restore.js + gancio in handleLogin (vitest)
 *
 * [JHT-CLOUD-RESTORE] T-029 — il lato PULL del bootstrap: dopo `jht cloud
 * login`, se il jobs.db locale è VUOTO, il restore parte da solo. Simmetrico
 * al bootstrap-push (box pieno → cloud), copre il container nuovo su un
 * account con storia.
 *
 * Cosa proteggono questi test:
 *   1. la decisione parte SOLO su DB vuoto — mai sovrascrivere lavoro locale;
 *   2. il gancio nel login: DB vuoto → full-dump chiamato e righe ripristinate,
 *      push saltato; DB pieno → push, full-dump mai chiamato;
 *   3. fail-safe: cloud giù → pairing comunque OK, nessun exitCode=1 appiccicoso.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  decideBootstrapRestore,
  readLocalPositionsCount,
} from "../../../cli/src/lib/bootstrap-restore.js";

type CloudModule = typeof import("../../../cli/src/commands/cloud.js");

/** Budget dei tre test che eseguono `handleLogin`, misurato — non il default.
 *
 * Ogni login porta almeno UN SECONDO di sonno per contratto: cloud.js clampa
 * l'intervallo di poll a `Math.max(1, init.interval)` secondi e ci dorme
 * sopra prima di interrogare device-poll — il mock chiede già `interval: 1`,
 * cioè il minimo, quindi quel secondo non si comprime da qui. Sopra ci vanno
 * `vi.resetModules()` + il re-import del grafo di cloud.js e la creazione del
 * jobs.db con lo schema intero. Misurato a macchina scarica (--reporter=
 * verbose, 2026-08-12): 2472ms, 1361ms, 1539ms.
 *
 * Il default di vitest è 5000ms: margine ~2× su un lavoro che parte da 1s di
 * sleep, su un host dove la suite gira con 13 worker in parallelo. È il
 * motivo per cui questo file cadeva con «Test timed out in 5000ms» dentro la
 * suite intera — visto in due run normali e sotto saturazione — e passava
 * rieseguito da solo: il rosso misurava la macchina, non il codice. Stessa
 * forma di daemon.test.ts, stessa cura: 15s, la cifra già usata dai file che
 * avviano processi (cli-runtime-status, doctor-provider-auth). */
const LOGIN_TEST_TIMEOUT_MS = 15_000;

let home: string;
let dbPath: string;
let originalJhtHome: string | undefined;

/** Schema minimo ma fedele, come in cloud-restore.test.ts — PIU' le colonne
 *  che il push seleziona (senza, handlePush abortisce prima di parlare). */
function createLocalDb(positions: { id: number; title: string; url?: string }[] = []) {
  rmSync(dbPath, { force: true });
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
      recheck_requested INTEGER, recheck_requested_at TEXT,
      salary_precise_requested INTEGER, salary_precise_requested_at TEXT,
      salary_precise TEXT,
      loc_continent TEXT, work_mode TEXT,
      expires_at TEXT, is_open INTEGER, last_open_check TEXT,
      created_at TEXT, updated_at TEXT
    );
    CREATE UNIQUE INDEX idx_positions_url_unique
      ON positions(url) WHERE url IS NOT NULL AND url <> '';
    CREATE TABLE scores (
      position_id INTEGER PRIMARY KEY, total_score INTEGER,
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
  `);
  for (const p of positions) {
    db.prepare("INSERT INTO positions (id, title, company, url) VALUES (?, ?, ?, ?)")
      .run(p.id, p.title, "Acme", p.url ?? null);
  }
  db.close();
}

function response(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const CLOUD_POSITIONS = [
  { id: "uuid-a", legacy_id: 11, title: "Cloud job one", company: "Acme",
    url: "https://boards.example/jobs/11" },
  { id: "uuid-b", legacy_id: 12, title: "Cloud job two", company: "Beta",
    url: "https://boards.example/jobs/12" },
];

/** Router fetch per il login: pairing → preflight → dump/push a seconda del ramo. */
function mockLoginFetch(options: { dumpStatus?: number } = {}) {
  const calls: string[] = [];
  const fn = vi.fn(async (url: unknown) => {
    const u = String(url);
    calls.push(u);
    if (u.endsWith("/api/cloud-sync/device-init")) {
      return response(200, {
        device_code: "dc-1", user_code: "UC-1234",
        verification_url: "https://cloud.example.test/activate",
        interval: 1, expires_in: 60,
      });
    }
    if (u.endsWith("/api/cloud-sync/device-poll")) {
      return response(200, {
        status: "approved", token: "jht_sync_restore-token",
        user_id: "user-1", token_name: "laptop-restore",
      });
    }
    if (u.endsWith("/api/team-state")) return response(200, { state: {} });
    if (u.endsWith("/api/cloud-sync/full-dump")) {
      if (options.dumpStatus && options.dumpStatus !== 200) {
        return response(options.dumpStatus, { error: "cloud is down" });
      }
      return response(200, {
        dump: { positions: CLOUD_POSITIONS, scores: [], applications: [] },
      });
    }
    if (u.endsWith("/api/cloud-sync/push")) return response(200, {});
    throw new Error(`unexpected fetch: ${u}`);
  });
  return { fn, calls };
}

function outputOf(spy: ReturnType<typeof vi.spyOn>) {
  return spy.mock.calls.map((args) => args.map(String).join(" ")).join("\n");
}

function localPositionIds(): number[] {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const rows = db.prepare("SELECT id FROM positions ORDER BY id").all();
  db.close();
  return rows.map((r) => (r as { id: number }).id);
}

async function loadCloud(): Promise<CloudModule> {
  vi.resetModules();
  return import("../../../cli/src/commands/cloud.js");
}

beforeEach(() => {
  originalJhtHome = process.env.JHT_HOME;
  home = mkdtempSync(join(tmpdir(), "jht-bootstrap-restore-"));
  process.env.JHT_HOME = home;
  dbPath = join(home, "jobs.db");
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
  rmSync(home, { recursive: true, force: true });
  if (originalJhtHome === undefined) delete process.env.JHT_HOME;
  else process.env.JHT_HOME = originalJhtHome;
  process.exitCode = undefined;
});

describe("decideBootstrapRestore — la decisione pura", () => {
  it("DB vuoto → restore; le altre forme di DB → mai", () => {
    expect(decideBootstrapRestore({ dbPresent: true, localPositions: 0 }))
      .toEqual({ restore: true, reason: "db-vuoto" });
    expect(decideBootstrapRestore({ dbPresent: true, localPositions: 3 }).restore).toBe(false);
    expect(decideBootstrapRestore({ dbPresent: false, localPositions: null }).restore).toBe(false);
    expect(decideBootstrapRestore({ dbPresent: true, localPositions: null }).restore).toBe(false);
    expect(decideBootstrapRestore({ dbPresent: true, localPositions: 0, cloudEnabled: false }).restore)
      .toBe(false);
  });
});

describe("readLocalPositionsCount — la sonda read-only", () => {
  it("conta le positions; tabella assente → null (non si decide su un dubbio)", () => {
    createLocalDb();
    expect(readLocalPositionsCount(DatabaseSync, dbPath)).toBe(0);
    createLocalDb([{ id: 1, title: "one" }, { id: 2, title: "two" }]);
    expect(readLocalPositionsCount(DatabaseSync, dbPath)).toBe(2);

    const emptyDb = join(home, "no-schema.db");
    new DatabaseSync(emptyDb).close();
    expect(readLocalPositionsCount(DatabaseSync, emptyDb)).toBeNull();
  });
});

describe("jht cloud login — gancio bootstrap restore (T-029)", () => {
  it("DB vuoto: il restore parte da solo, il push viene saltato", async () => {
    createLocalDb();
    const { fn, calls } = mockLoginFetch();
    vi.stubGlobal("fetch", fn);
    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
    const { handleLogin } = await loadCloud();

    await handleLogin({});

    expect(calls.some((u) => u.endsWith("/api/cloud-sync/full-dump"))).toBe(true);
    expect(calls.some((u) => u.endsWith("/api/cloud-sync/push"))).toBe(false);
    expect(localPositionIds()).toEqual([11, 12]);
    expect(outputOf(stdout)).toContain("automatic bootstrap restore");
    expect(outputOf(stdout)).toContain("2 upserted");
    expect(process.exitCode).toBeUndefined();
  }, LOGIN_TEST_TIMEOUT_MS);

  it("DB con lavoro locale: niente restore, si va sul push — full-dump mai chiamato", async () => {
    createLocalDb([{ id: 5, title: "Local work", url: "https://boards.example/jobs/5" }]);
    const { fn, calls } = mockLoginFetch();
    vi.stubGlobal("fetch", fn);
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { handleLogin } = await loadCloud();

    await handleLogin({});

    expect(calls.some((u) => u.endsWith("/api/cloud-sync/full-dump"))).toBe(false);
    expect(calls.some((u) => u.endsWith("/api/cloud-sync/push"))).toBe(true);
    // Il lavoro locale è intatto e non è arrivato niente dal cloud.
    expect(localPositionIds()).toEqual([5]);
    expect(process.exitCode).toBeUndefined();
  }, LOGIN_TEST_TIMEOUT_MS);

  it("cloud giù durante il restore automatico: pairing OK, fail-safe senza exitCode appiccicoso", async () => {
    createLocalDb();
    const { fn } = mockLoginFetch({ dumpStatus: 503 });
    vi.stubGlobal("fetch", fn);
    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    const { handleLogin } = await loadCloud();

    await handleLogin({});

    expect(localPositionIds()).toEqual([]);
    expect(outputOf(stderr)).toContain("Dump failed (HTTP 503)");
    expect(outputOf(stdout)).toContain("automatic restore failed. Recover: jht cloud restore");
    expect(process.exitCode).toBeUndefined();
  }, LOGIN_TEST_TIMEOUT_MS);
});
