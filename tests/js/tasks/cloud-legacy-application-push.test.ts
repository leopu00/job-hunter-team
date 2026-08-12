/** O-64 — il push CLI deve accettare jobs.db creati prima di critic_round. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

let home: string;
let dbPath: string;
let originalJhtHome: string | undefined;

function createLegacyDatabase() {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE applications (
      position_id INTEGER PRIMARY KEY,
      cv_path TEXT, cv_pdf_path TEXT, cl_path TEXT, cl_pdf_path TEXT,
      status TEXT, critic_score REAL, critic_verdict TEXT, critic_notes TEXT,
      written_at TEXT, applied_at TEXT, applied_via TEXT,
      response TEXT, response_at TEXT, written_by TEXT, reviewed_by TEXT,
      critic_reviewed_at TEXT, applied INTEGER,
      cv_drive_id TEXT, cl_drive_id TEXT,
      created_at TEXT, updated_at TEXT
    );
    INSERT INTO applications (
      position_id, status, critic_score, critic_verdict, critic_notes,
      written_at, reviewed_by, critic_reviewed_at, updated_at
    ) VALUES (
      42, 'ready', 7.5, 'PASS', 'feedback legacy',
      '2026-08-11 00:58:00', 'critico-test', '2026-07-14 16:20:00',
      '2026-08-11 00:58:00'
    );
  `);
  db.close();
}

beforeEach(() => {
  originalJhtHome = process.env.JHT_HOME;
  home = mkdtempSync(join(tmpdir(), "jht-o64-legacy-push-"));
  process.env.JHT_HOME = home;
  process.exitCode = undefined;
  dbPath = join(home, "jobs.db");
  writeFileSync(
    join(home, "cloud.json"),
    JSON.stringify({
      enabled: true,
      base_url: "https://cloud.example.test",
      token: "jht_sync_synthetic-test-token",
    }),
  );
  createLegacyDatabase();
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

describe("jht cloud push — applications legacy", () => {
  it("invia una application da uno schema realmente privo di critic_round", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body ?? "{}")));
        return new Response(JSON.stringify({ applications: { upserted: 1 } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.resetModules();
    const { handlePush } = await import("../../../cli/src/commands/cloud.js");

    const result = await handlePush({ db: dbPath, full: true });

    expect(result).toMatchObject({ ok: true, skipped: 0 });
    expect(process.exitCode).toBeUndefined();
    const applications = bodies.flatMap((body) =>
      Array.isArray(body.applications)
        ? (body.applications as Record<string, unknown>[])
        : [],
    );
    expect(applications).toHaveLength(1);
    expect(applications[0]).not.toHaveProperty("critic_round");
    expect(applications[0]).toMatchObject({
      position_id: 42,
      critic_verdict: "PASS",
    });
  });
});
