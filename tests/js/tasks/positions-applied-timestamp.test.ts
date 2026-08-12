import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const requireFromWeb = createRequire(
  join(__dirname, "../../../web/package.json"),
);
const Database = requireFromWeb("better-sqlite3");

let home: string;
let getPositionsLocal: typeof import("@/lib/local-queries").getPositionsLocal;

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "jht-applied-date-"));
  process.env.JHT_HOME = home;
  const db = new Database(join(home, "jobs.db"));
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE positions (
      id INTEGER PRIMARY KEY, legacy_id INTEGER, title TEXT, company TEXT,
      location TEXT, remote_type TEXT, source TEXT, found_by TEXT,
      found_at TEXT, status TEXT, notes TEXT, last_checked TEXT,
      role_family TEXT, loc_country TEXT, loc_city TEXT, url TEXT,
      salary_declared_min INTEGER, salary_declared_max INTEGER,
      salary_declared_currency TEXT, salary_estimated_min INTEGER,
      salary_estimated_max INTEGER, salary_estimated_currency TEXT,
      salary_estimated_source TEXT, write_requested INTEGER,
      status_changed_at TEXT, last_actor TEXT
    );
    CREATE TABLE scores (
      position_id INTEGER, total_score INTEGER, stack_match INTEGER,
      remote_fit INTEGER, salary_fit INTEGER, strategic_fit INTEGER,
      scored_at TEXT, scored_by TEXT
    );
    CREATE TABLE applications (
      position_id INTEGER, written_at TEXT, written_by TEXT,
      critic_reviewed_at TEXT, reviewed_by TEXT, applied_at TEXT,
      response_at TEXT, critic_score REAL, critic_verdict TEXT
    );
    CREATE TABLE position_tickets (
      id INTEGER PRIMARY KEY, position_id INTEGER, status TEXT
    );
    INSERT INTO positions
      (id, legacy_id, title, company, found_at, status, source)
    VALUES
      (73, 73, 'Applied fixture', 'Example', '2026-08-01T09:00:00Z',
       'applied', 'synthetic'),
      (74, 74, 'Scored fixture', 'Example', '2026-08-02T09:00:00Z',
       'scored', 'synthetic');
    INSERT INTO applications (position_id, applied_at)
    VALUES (73, '2026-08-12T16:30:00.000Z');
    INSERT INTO scores (position_id, total_score, scored_at)
    VALUES (74, 88, '2026-08-11T10:00:00.000Z');
  `);
  db.close();
  ({ getPositionsLocal } = await import("@/lib/local-queries"));
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("data candidatura nella lista SQLite", () => {
  it("mostra application.applied_at sulla posizione applied", () => {
    const rows = getPositionsLocal(home, { statuses: ["applied"] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      legacy_id: 73,
      status: "applied",
      applied_at: "2026-08-12T16:30:00.000Z",
    });
  });

  it("non scambia la data dello score per una candidatura", () => {
    const rows = getPositionsLocal(home, { statuses: ["scored"] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ legacy_id: 74, applied_at: null });
  });
});
