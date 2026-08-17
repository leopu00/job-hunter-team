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
      id INTEGER PRIMARY KEY AUTOINCREMENT, position_id INTEGER UNIQUE,
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

function acknowledged(table: string, rows: Array<{ _receipt_id?: string }>) {
  return {
    receipts: { [table]: rows.map((row) => row._receipt_id) },
    [table]: { upserted: rows.length },
  };
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
  it("aborts before network when two rows have no stable source identity", async () => {
    const { home, dbPath } = fixture();
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE companies (
        id INTEGER, name TEXT, website TEXT, hq_country TEXT, sector TEXT,
        size TEXT, glassdoor_rating REAL, red_flags TEXT, culture_notes TEXT,
        analyzed_by TEXT, analyzed_at TEXT, verdict TEXT, updated_at TEXT
      );
      INSERT INTO companies (id, name, updated_at) VALUES
        (NULL, 'Synthetic one', '2026-08-13 10:00:00'),
        (NULL, 'Synthetic two', '2026-08-13 10:01:00');
    `);
    db.close();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    const { handlePush } = await import("../../../cli/src/commands/cloud.js");

    await expect(handlePush({ db: dbPath, full: true })).resolves.toMatchObject(
      {
        ok: false,
        skipped: 0,
      },
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(() =>
      readFileSync(join(home, ".cloud-push-quarantine.json"), "utf8"),
    ).toThrow();
    expect(() =>
      readFileSync(join(home, ".cloud-sync-cursor.json"), "utf8"),
    ).toThrow();
  });

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
          position_legacy_id?: number;
        }>;
        if (
          table === "applications" &&
          rows.some((row) => row.position_legacy_id === 2)
        ) {
          return jsonResponse(
            {
              error: "applications_upsert_failed",
              rejection_scope: "row",
              detail: "synthetic server detail must not be persisted",
            },
            422,
          );
        }
        if (table === "applications")
          acceptedApplications.push(
            ...rows.map((row) => row.position_legacy_id!),
          );
        return jsonResponse(acknowledged(table, rows));
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

  it("fails closed without quarantine on an exact receipt mismatch", async () => {
    const { home, dbPath } = fixture();
    const acceptedApplications: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body || "{}"));
        const table = Object.keys(body)[0];
        const rows = body[table] as Array<{ position_legacy_id?: number }>;
        const rejected =
          table === "applications" &&
          rows.some((row) => row.position_legacy_id === 2);
        if (table === "applications" && !rejected)
          acceptedApplications.push(
            ...rows.map((row) => row.position_legacy_id!),
          );
        return jsonResponse({
          ...acknowledged(table, rows),
          receipts: {
            [table]: rows.map((row: any) =>
              rejected && row.position_legacy_id === 2
                ? "q_ffffffffffffffffffffffff"
                : row._receipt_id,
            ),
          },
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
        skipped: 0,
      },
    );
    expect(acceptedApplications).toEqual([]);
    expect(() =>
      readFileSync(join(home, ".cloud-push-quarantine.json"), "utf8"),
    ).toThrow();
    const cursor = JSON.parse(
      readFileSync(join(home, ".cloud-sync-cursor.json"), "utf8"),
    );
    expect(cursor.positions).toBe("2026-08-13 10:02:00");
    expect(cursor.applications).toBeUndefined();
  });

  it("does not quarantine a generic HTTP 400 without row attestation", async () => {
    const { home, dbPath } = fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body || "{}"));
        const table = Object.keys(body)[0];
        const rows = body[table] as any[];
        if (table === "applications") {
          return jsonResponse({ error: "generic_bad_request" }, 400);
        }
        return jsonResponse(acknowledged(table, rows));
      }),
    );
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    const { handlePush } = await import("../../../cli/src/commands/cloud.js");

    await expect(handlePush({ db: dbPath, full: true })).resolves.toMatchObject(
      {
        ok: false,
        skipped: 0,
      },
    );
    expect(() =>
      readFileSync(join(home, ".cloud-push-quarantine.json"), "utf8"),
    ).toThrow();
  });

  it("treats an invalid receipt response as protocol failure, not a bad row", async () => {
    const { home, dbPath } = fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body || "{}"));
        const table = Object.keys(body)[0];
        const rows = body[table] as Array<{ _receipt_id?: string }>;
        if (table === "applications") {
          return jsonResponse({ error: "invalid_application_receipt_id" }, 400);
        }
        return jsonResponse(acknowledged(table, rows));
      }),
    );
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    const { handlePush } = await import("../../../cli/src/commands/cloud.js");

    await expect(handlePush({ db: dbPath, full: true })).resolves.toMatchObject(
      {
        ok: false,
        skipped: 0,
      },
    );
    expect(() =>
      readFileSync(join(home, ".cloud-push-quarantine.json"), "utf8"),
    ).toThrow();
    const cursor = JSON.parse(
      readFileSync(join(home, ".cloud-sync-cursor.json"), "utf8"),
    );
    expect(cursor.positions).toBe("2026-08-13 10:02:00");
    expect(cursor.applications).toBeUndefined();
  });

  it("bisects 413 and gives a singleton oversize an explicit quarantine reason", async () => {
    const { home, dbPath } = fixture();
    const acceptedApplications: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body || "{}"));
        const table = Object.keys(body)[0];
        const rows = body[table] as Array<{ position_legacy_id?: number }>;
        if (
          table === "applications" &&
          rows.some((row) => row.position_legacy_id === 2)
        ) {
          return jsonResponse({ error: "request_too_large" }, 413);
        }
        if (table === "applications") {
          acceptedApplications.push(
            ...rows.map((row) => row.position_legacy_id!),
          );
        }
        return jsonResponse(acknowledged(table, rows));
      }),
    );
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    const { handlePush } = await import("../../../cli/src/commands/cloud.js");

    await expect(handlePush({ db: dbPath, full: true })).resolves.toMatchObject(
      {
        ok: true,
        quarantined: 1,
      },
    );
    expect(acceptedApplications).toEqual([1, 3]);
    const quarantine = readFileSync(
      join(home, ".cloud-push-quarantine.json"),
      "utf8",
    );
    expect(quarantine).toContain("http_413:payload_too_large");
    expect(quarantine).not.toContain("request_too_large");
  });

  it("aborts without quarantine when a successful server omits row receipts", async () => {
    const { home, dbPath } = fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body || "{}"));
        const table = Object.keys(body)[0];
        const rows = body[table] as unknown[];
        return jsonResponse({ [table]: { upserted: rows.length } });
      }),
    );
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    const { handlePush } = await import("../../../cli/src/commands/cloud.js");

    await expect(handlePush({ db: dbPath, full: true })).resolves.toMatchObject(
      {
        ok: false,
        skipped: 0,
      },
    );
    expect(() =>
      readFileSync(join(home, ".cloud-push-quarantine.json"), "utf8"),
    ).toThrow();
    expect(() =>
      readFileSync(join(home, ".cloud-sync-cursor.json"), "utf8"),
    ).toThrow();
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
          return jsonResponse(
            { error: "application_row_rejected", rejection_scope: "row" },
            422,
          );
        return jsonResponse(acknowledged(table, rows as any[]));
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

  it("keeps a classified 5xx convoy-wide without blaming or acknowledging a row", async () => {
    const { home, dbPath } = fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body || "{}"));
        const table = Object.keys(body)[0];
        const rows = body[table] as Array<unknown>;
        if (table === "applications")
          return jsonResponse({ error: "applications_upsert_failed" }, 500);
        return jsonResponse(acknowledged(table, rows as any[]));
      }),
    );
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    const { handlePush } = await import("../../../cli/src/commands/cloud.js");

    await expect(handlePush({ db: dbPath, full: true })).resolves.toMatchObject(
      {
        ok: false,
        skipped: 0,
      },
    );
    expect(
      readFileSync(join(home, ".cloud-sync-cursor.json"), "utf8"),
    ).toContain("positions");
    expect(() =>
      readFileSync(join(home, ".cloud-push-quarantine.json"), "utf8"),
    ).toThrow();
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
        const rows = body[table] as Array<{ position_legacy_id?: number }>;
        if (table === "applications" && rows.length > 1)
          return jsonResponse(
            { error: "application_row_rejected", rejection_scope: "row" },
            422,
          );
        if (table === "applications" && rows[0]?.position_legacy_id === 2)
          return jsonResponse(
            { detail: "synthetic infrastructure failure" },
            503,
          );
        return jsonResponse(acknowledged(table, rows as any[]));
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
        const rows = body[table] as Array<{ position_legacy_id?: number }>;
        if (table === "applications") {
          applicationBatches.push(rows.map((row) => row.position_legacy_id!));
          if (reject && rows.some((row) => row.position_legacy_id === 2))
            return jsonResponse(
              {
                error: "applications_upsert_failed",
                rejection_scope: "row",
              },
              500,
            );
        }
        return jsonResponse(acknowledged(table, rows as any[]));
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

  it("replays all tables after corrupt quarantine metadata, then repairs it", async () => {
    const { home, dbPath } = fixture();
    let reject = true;
    const applicationBatches: number[][] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body || "{}"));
        const table = Object.keys(body)[0];
        const rows = body[table] as Array<{ position_legacy_id?: number }>;
        if (table === "applications") {
          applicationBatches.push(rows.map((row) => row.position_legacy_id!));
          if (reject && rows.some((row) => row.position_legacy_id === 2))
            return jsonResponse(
              {
                error: "applications_upsert_failed",
                rejection_scope: "row",
              },
              500,
            );
        }
        return jsonResponse(acknowledged(table, rows as any[]));
      }),
    );
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    let cloud = await import("../../../cli/src/commands/cloud.js");
    await cloud.handlePush({ db: dbPath, full: true });

    writeFileSync(join(home, ".cloud-push-quarantine.json"), "{not-json");
    reject = false;
    vi.resetModules();
    cloud = await import("../../../cli/src/commands/cloud.js");
    await expect(cloud.handlePush({ db: dbPath })).resolves.toMatchObject({
      ok: true,
      quarantined: 0,
    });
    expect(applicationBatches.at(-1)).toEqual([1, 2, 3]);
    const repaired = JSON.parse(
      readFileSync(join(home, ".cloud-push-quarantine.json"), "utf8"),
    );
    expect(repaired).toMatchObject({ version: 1, entries: [] });
  });

  /**
   * O-97 — il rifiuto che insegna, e la prova che il locale cambia davvero.
   *
   * Il cloud rifiuta di riportare indietro una posizione candidata e allega
   * cio' che sa. Prima, il box ripresentava lo stesso downgrade a ogni tick e
   * il push non drenava piu': smettere di fallire non basta, deve cambiare
   * idea. Qui si guarda il DATABASE LOCALE dopo il push, non il codice di
   * ritorno — un push «ok» con lo stato locale immutato e' il difetto, non la
   * sua assenza.
   */
  function conStoricoCandidature(dbPath: string) {
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE scores (
        id INTEGER PRIMARY KEY, position_id INTEGER, total_score INTEGER,
        experience_fit INTEGER, salary_fit INTEGER, stack_match INTEGER,
        remote_fit INTEGER, strategic_fit INTEGER, breakdown TEXT,
        notes TEXT, scored_by TEXT, scored_at TEXT, updated_at TEXT
      );
      CREATE TABLE position_state_transitions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, position_id INTEGER,
        from_state TEXT, to_state TEXT, ts TEXT, by_agent TEXT, notes TEXT
      );
    `);
    db.close();
  }

  const rifiutoDowngrade = (conFotografia: boolean) =>
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || "{}"));
      const table = Object.keys(body)[0];
      const rows = body[table] as Array<{ id?: number }>;
      if (table === "positions" && rows.some((row) => row.id === 2)) {
        // Il 500 opaco che PostgREST produce da un RAISE EXCEPTION senza
        // SQLSTATE: e' il caso vero, non un 422 di comodo.
        return jsonResponse(
          {
            error: "positions_upsert_failed",
            rejection_scope: "row",
            ...(conFotografia && rows.length === 1
              ? {
                  stale_position: {
                    legacy_id: 2,
                    applied: true,
                    applied_at: "2026-08-16T09:30:00+00:00",
                    applied_via: "user_manual",
                  },
                }
              : {}),
          },
          500,
        );
      }
      return jsonResponse(acknowledged(table, rows));
    });

  const candidaturaLocale = (dbPath: string, positionId: number) => {
    const db = new DatabaseSync(dbPath);
    const riga = db
      .prepare(
        "SELECT a.applied AS applied, a.applied_via AS applied_via, " +
          "p.status AS status FROM positions p " +
          "LEFT JOIN applications a ON a.position_id = p.id WHERE p.id = ?",
      )
      .get(positionId) as Record<string, unknown>;
    db.close();
    return riga;
  };

  it("impara dalla fotografia del cloud e rimette la riga in coda", async () => {
    const { home, dbPath } = fixture();
    conStoricoCandidature(dbPath);
    expect(candidaturaLocale(dbPath, 2).applied).toBeFalsy();
    vi.stubGlobal("fetch", rifiutoDowngrade(true));
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    const { handlePush } = await import("../../../cli/src/commands/cloud.js");

    await expect(handlePush({ db: dbPath, full: true })).resolves.toMatchObject(
      { ok: true, quarantinedNew: 1 },
    );

    // (1) Il locale ha imparato: e' questo che rompe il ciclo, non il fatto
    // che la richiesta sia finita senza errori.
    expect(candidaturaLocale(dbPath, 2)).toMatchObject({
      applied: 1,
      applied_via: "user_manual",
      status: "applied",
    });
    // (2) La riga corretta torna in coda da sola: senza il retry il box
    // imparerebbe e resterebbe zitto fino a un comando dato a mano.
    const quarantena = JSON.parse(
      readFileSync(join(home, ".cloud-push-quarantine.json"), "utf8"),
    );
    expect(quarantena.entries).toHaveLength(1);
    expect(quarantena.entries[0]).toMatchObject({
      table: "positions",
      status: "retry",
    });
  });

  it("senza fotografia non inventa niente e la riga resta ferma", async () => {
    // Il controllo negativo: stesso rifiuto, stessa bisezione, ma il server
    // non dice cosa sa. Il box non deve dedurre lo stato da un errore — un
    // apprendimento immaginato sarebbe peggio del difetto che chiude.
    const { home, dbPath } = fixture();
    conStoricoCandidature(dbPath);
    vi.stubGlobal("fetch", rifiutoDowngrade(false));
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    const { handlePush } = await import("../../../cli/src/commands/cloud.js");

    await expect(handlePush({ db: dbPath, full: true })).resolves.toMatchObject(
      { ok: true, quarantinedNew: 1 },
    );

    expect(candidaturaLocale(dbPath, 2).applied).toBeFalsy();
    const quarantena = JSON.parse(
      readFileSync(join(home, ".cloud-push-quarantine.json"), "utf8"),
    );
    expect(quarantena.entries[0]).toMatchObject({ status: "active" });
  });
});
