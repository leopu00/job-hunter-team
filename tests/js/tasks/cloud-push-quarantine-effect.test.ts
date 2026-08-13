import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";

const dirs: string[] = [];
let previousHome: string | undefined;

function fixture() {
  previousHome = process.env.JHT_HOME;
  const home = mkdtempSync(join(tmpdir(), "jht-quarantine-effect-"));
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
  db.exec(`
    CREATE TABLE positions (
      id INTEGER PRIMARY KEY, title TEXT, company TEXT, company_id INTEGER,
      url TEXT, location TEXT, remote_type TEXT, status TEXT, notes TEXT,
      source TEXT, jd_text TEXT, jd_summary TEXT, requirements TEXT,
      found_by TEXT, found_at TEXT, deadline TEXT, last_checked TEXT,
      last_actor TEXT, salary_declared_min INTEGER,
      salary_declared_max INTEGER, salary_declared_currency TEXT,
      salary_estimated_min INTEGER, salary_estimated_max INTEGER,
      salary_estimated_currency TEXT, salary_estimated_source TEXT,
      write_requested INTEGER, write_requested_at TEXT,
      geocode_requested INTEGER, geocode_requested_at TEXT,
      recheck_requested INTEGER, recheck_requested_at TEXT,
      salary_precise_requested INTEGER, salary_precise_requested_at TEXT,
      salary_precise TEXT, role_family TEXT, loc_city TEXT, loc_region TEXT,
      loc_country TEXT, loc_country_code TEXT, loc_continent TEXT,
      work_mode TEXT, work_country TEXT, work_country_code TEXT,
      location_notes TEXT, is_multi_location INTEGER, office_lat REAL,
      office_lon REAL, office_address TEXT, office_geocoded INTEGER,
      office_verified INTEGER, expires_at TEXT, is_open INTEGER,
      last_open_check TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE applications (
      position_id INTEGER PRIMARY KEY,
      cv_path TEXT, cv_pdf_path TEXT, cl_path TEXT, cl_pdf_path TEXT,
      status TEXT, critic_score REAL, critic_verdict TEXT, critic_notes TEXT,
      critic_round INTEGER, written_at TEXT, applied_at TEXT, applied_via TEXT,
      response TEXT, response_at TEXT, written_by TEXT, reviewed_by TEXT,
      critic_reviewed_at TEXT, applied INTEGER, cv_drive_id TEXT,
      cl_drive_id TEXT, created_at TEXT, updated_at TEXT
    );
  `);
  const insertPosition = db.prepare(
    "INSERT INTO positions (id,title,company,status,updated_at) VALUES (?,?,'Synthetic company','new',?)",
  );
  const insertApplication = db.prepare(
    "INSERT INTO applications (position_id,status,critic_notes,updated_at) VALUES (?,'ready',?,?)",
  );
  for (const [id, minute] of [
    [1, "00"],
    [2, "01"],
    [3, "02"],
  ] as const) {
    insertPosition.run(
      id,
      `Synthetic role ${id}`,
      `2026-08-13 10:${minute}:00`,
    );
    insertApplication.run(
      id,
      `synthetic body ${id} must stay out of quarantine metadata`,
      `2026-08-13 10:${minute}:30`,
    );
  }
  db.close();
  return { home, dbPath };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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

describe("cloud push record isolation — real writer path", () => {
  it("quarantines one rejected application and delivers valid rows before/after", async () => {
    const { home, dbPath } = fixture();
    const acceptedApplications: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body || "{}"));
        const table = Object.keys(body)[0];
        const rows = body[table] as Array<{
          id?: number;
          position_id?: number;
        }>;
        if (
          table === "applications" &&
          rows.some((row) => row.position_id === 2)
        ) {
          return jsonResponse(
            {
              error: "applications_upsert_failed",
              detail: "synthetic server detail must not be persisted",
            },
            500,
          );
        }
        if (table === "applications")
          acceptedApplications.push(...rows.map((row) => row.position_id!));
        return jsonResponse({
          accepted: { [table]: rows.length },
          [table]: { upserted: rows.length },
        });
      }),
    );
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    const { handlePush } = await import("../../../cli/src/commands/cloud.js");

    await expect(handlePush({ db: dbPath, full: true })).resolves.toMatchObject(
      {
        ok: true,
        skipped: 1,
        quarantined: 1,
        quarantinedNew: 1,
      },
    );
    expect(acceptedApplications).toEqual([1, 3]);

    const cursor = JSON.parse(
      readFileSync(join(home, ".cloud-sync-cursor.json"), "utf8"),
    );
    expect(cursor).toMatchObject({
      positions: "2026-08-13 10:02:00",
      applications: "2026-08-13 10:02:30",
    });
    const quarantine = readFileSync(
      join(home, ".cloud-push-quarantine.json"),
      "utf8",
    );
    expect(quarantine).toContain("applications_upsert_failed");
    expect(quarantine).not.toContain("synthetic body");
    expect(quarantine).not.toContain("synthetic server detail");
  });

  it("bisects an HTTP 200 acknowledgement mismatch instead of silently skipping", async () => {
    const { home, dbPath } = fixture();
    const acceptedApplications: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body || "{}"));
        const table = Object.keys(body)[0];
        const rows = body[table] as Array<{ position_id?: number }>;
        const rejected =
          table === "applications" &&
          rows.some((row) => row.position_id === 2);
        if (table === "applications" && !rejected)
          acceptedApplications.push(...rows.map((row) => row.position_id!));
        return jsonResponse({
          accepted: { [table]: rejected ? rows.length - 1 : rows.length },
          [table]: { upserted: rejected ? rows.length - 1 : rows.length },
        });
      }),
    );
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    const { handlePush } = await import("../../../cli/src/commands/cloud.js");

    await expect(handlePush({ db: dbPath, full: true })).resolves.toMatchObject({
      ok: true,
      quarantined: 1,
    });
    expect(acceptedApplications).toEqual([1, 3]);
    expect(
      readFileSync(join(home, ".cloud-push-quarantine.json"), "utf8"),
    ).toContain("acknowledgement_mismatch");
  });

  it("keeps earlier table checkpoints when durable quarantine itself fails", async () => {
    const { home, dbPath } = fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body || "{}"));
        const table = Object.keys(body)[0];
        const rows = body[table] as Array<unknown>;
        if (table === "applications")
          return jsonResponse({ error: "applications_upsert_failed" }, 500);
        return jsonResponse({
          accepted: { [table]: rows.length },
          [table]: { upserted: rows.length },
        });
      }),
    );
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    const { handlePush } = await import("../../../cli/src/commands/cloud.js");

    // A directory cannot be atomically replaced by the metadata writer.
    await expect(
      handlePush({ db: dbPath, full: true, quarantinePath: home }),
    ).resolves.toMatchObject({ ok: false });
    const cursor = JSON.parse(
      readFileSync(join(home, ".cloud-sync-cursor.json"), "utf8"),
    );
    expect(cursor.positions).toBe("2026-08-13 10:02:00");
    expect(cursor.applications).toBeUndefined();
  });

  it("does not checkpoint a timestamp shared with an unsettled row", async () => {
    const { home, dbPath } = fixture();
    const db = new DatabaseSync(dbPath);
    db.prepare(
      "UPDATE applications SET updated_at = ? WHERE position_id IN (1, 2)",
    ).run("2026-08-13 10:00:30");
    db.close();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body || "{}"));
        const table = Object.keys(body)[0];
        const rows = body[table] as Array<{ position_id?: number }>;
        if (table === "applications" && rows.length > 1)
          return jsonResponse({ error: "application_row_rejected" }, 422);
        if (table === "applications" && rows[0]?.position_id === 2)
          return jsonResponse(
            { detail: "synthetic infrastructure failure" },
            503,
          );
        return jsonResponse({
          accepted: { [table]: rows.length },
          [table]: { upserted: rows.length },
        });
      }),
    );
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    const { handlePush } = await import("../../../cli/src/commands/cloud.js");

    await expect(handlePush({ db: dbPath, full: true })).resolves.toMatchObject(
      {
        ok: false,
      },
    );
    const cursor = JSON.parse(
      readFileSync(join(home, ".cloud-sync-cursor.json"), "utf8"),
    );
    expect(cursor.positions).toBe("2026-08-13 10:02:00");
    expect(cursor.applications).toBeUndefined();
  });

  it("retries from durable state after restart and resolves only after ACK", async () => {
    const { home, dbPath } = fixture();
    let reject = true;
    const applicationBatches: number[][] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body || "{}"));
        const table = Object.keys(body)[0];
        const rows = body[table] as Array<{ position_id?: number }>;
        if (table === "applications") {
          applicationBatches.push(rows.map((row) => row.position_id!));
          if (reject && rows.some((row) => row.position_id === 2))
            return jsonResponse({ error: "applications_upsert_failed" }, 500);
        }
        return jsonResponse({
          accepted: { [table]: rows.length },
          [table]: { upserted: rows.length },
        });
      }),
    );
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    let cloud = await import("../../../cli/src/commands/cloud.js");
    await cloud.handlePush({ db: dbPath, full: true });

    vi.resetModules();
    const quarantine =
      await import("../../../cli/src/lib/cloud-push-quarantine.js");
    const state = quarantine.readCloudPushQuarantine();
    const identity = quarantine.activeQuarantineEntries(state)[0].identity;
    expect(quarantine.requestQuarantineRetry(identity).changed).toBe(1);

    reject = false;
    vi.resetModules();
    cloud = await import("../../../cli/src/commands/cloud.js");
    await expect(cloud.handlePush({ db: dbPath })).resolves.toMatchObject({
      ok: true,
      skipped: 0,
      quarantined: 0,
    });
    const finalState = quarantine.readCloudPushQuarantine();
    expect(quarantine.activeQuarantineEntries(finalState)).toEqual([]);
    expect(finalState.entries).toHaveLength(1);
    expect(finalState.entries[0]).toMatchObject({
      identity,
      attempts: 1,
      status: "resolved",
    });
    expect(applicationBatches.at(-1)).toEqual([1, 2, 3]);
  });
});
