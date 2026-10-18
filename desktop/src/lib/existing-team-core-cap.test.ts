import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readerOnDatabase } from "./existing-team-reader-fixture";

// The reader the core runs on the team's VPS (POSITIONS_READ_PY, in
// src-tauri/src/existing_team_runtime.rs), run for real on a database whose rows
// are as heavy as the team's (~44 KB of text each: the CLI measured ~8 KB a
// row, and descriptions are not bounded). The core throws away any reply over
// 2 MiB with `positions_unavailable`: this proves the largest request the
// pages make stays under it, on the projection the core really builds. Synthetic
// rows only.
const CORE_REPLY_CAP = 2 * 1024 * 1024;
const python = spawnSync("python3", ["-I", "-c", "import sqlite3"]);
const available = python.status === 0;

// vitest runs from desktop/
const SOURCE = readFileSync(resolve(process.cwd(), "src-tauri/src/existing_team_runtime.rs"), "utf8");
const READER = /const POSITIONS_READ_PY: &str = r#"([\s\S]*?)"#;/.exec(SOURCE)?.[1] ?? "";

const SETUP = `
import sqlite3, sys
db = sqlite3.connect(sys.argv[1])
db.executescript("""
create table positions(id integer primary key, legacy_id integer, title text, company text, company_id integer,
  location text, remote_type text, status text, source text, role_family text, loc_country text, loc_city text,
  found_at text, url text, jd_text text, jd_summary text, requirements text, notes text,
  salary_declared_min real, salary_declared_max real, salary_declared_currency text);
create table scores(id integer primary key, position_id integer, total_score real, breakdown text);
create table applications(id integer primary key, position_id integer, critic_score real, critic_verdict text);
""")
heavy = lambda n, tag: (tag + " " + "x" * 80 + "\\n") * (n // 90)
for i in range(1, 801):
    db.execute("insert into positions values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (
        i, 1000 + i, "Synthetic role %d" % i, "Synthetic Co %d" % (i % 40), None, "Alpha", "full_remote",
        "excluded" if i % 9 == 0 else "scored", "board-%d" % (i % 5), "Data", "AA", "Alpha",
        "2026-01-%02dT10:00:00Z" % (1 + i % 28), "https://invalid.example/%d" % i,
        heavy(20000, "jd"), heavy(4000, "summary"), heavy(10000, "req"), heavy(10000, "notes"), None, None, None))
    if i % 7:
        db.execute("insert into scores values(?,?,?,?)", (i, i, 40 + i % 60, heavy(2000, "breakdown")))
db.commit()
`;

let dir = "";
let database = "";
let reader = "";

function ask(request: unknown): { bytes: number; reply: any } {
  const run = spawnSync("python3", ["-I", reader], { input: `${JSON.stringify(request)}\n`, maxBuffer: 256 * 1024 * 1024 });
  expect(run.status, String(run.stderr)).toBe(0);
  return { bytes: run.stdout.length, reply: JSON.parse(run.stdout.toString("utf8")) };
}

beforeAll(() => {
  if (!available) return;
  dir = mkdtempSync(join(tmpdir(), "jht-core-cap-"));
  database = join(dir, "jobs.db");
  expect(spawnSync("python3", ["-I", "-c", SETUP, database]).status).toBe(0);
  expect(READER).toContain("mode=ro");
  reader = join(dir, "reader.py");
  writeFileSync(reader, readerOnDatabase(READER, database));
});
afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!available)("the core's list reply against its 2 MiB cap, on rows as heavy as the team's", () => {
  it("keeps the largest page the pages ask for (200 rows, default view) far under the cap", () => {
    const { bytes, reply } = ask({
      op: "list",
      filters: { limit: 200, offset: 0, sort: "found_at", dir: "desc", scoredOnly: true, hideExcluded: true },
    });
    expect(reply.ok).toBe(true);
    expect(reply.data.items).toHaveLength(200);
    expect(bytes).toBeLessThan(CORE_REPLY_CAP / 4);
  });

  it("keeps even the native bound (600 rows) under the cap", () => {
    const { bytes, reply } = ask({ op: "list", filters: { limit: 600, offset: 0, sort: "found_at", dir: "desc" } });
    expect(reply.data.items).toHaveLength(600);
    expect(bytes).toBeLessThan(CORE_REPLY_CAP);
  });

  it("counts what matches in all, before the page, with the default view applied by the core", () => {
    const all = ask({ op: "list", filters: { limit: 25, offset: 0 } }).reply.data;
    const view = ask({ op: "list", filters: { limit: 25, offset: 600, scoredOnly: true, hideExcluded: true } }).reply.data;
    expect(all.total).toBe(800);
    // 800 rows; 114 have no score (i % 7 == 0) and 88 are excluded (i % 9 == 0), 12 are both
    expect(view.total).toBe(800 - 114 - 88 + 12);
    expect(view.items.length).toBe(Math.max(0, Math.min(25, view.total - 600)));
    for (const row of ask({ op: "list", filters: { limit: 50, scoredOnly: true, hideExcluded: true } }).reply.data.items) {
      expect(row.score).not.toBeNull();
      expect(row.status).not.toBe("excluded");
    }
  });

  it("serves only the columns the table shows: the heavy text stays in the detail", () => {
    const [row] = ask({ op: "list", filters: { limit: 1 } }).reply.data.items;
    for (const heavy of ["jd_text", "jd_summary", "requirements", "notes", "scores", "url"]) {
      expect(row).not.toHaveProperty(heavy);
    }
    expect(row).toHaveProperty("title");
    expect(row).toHaveProperty("score");
    const detail = ask({ op: "detail", id: "1" }).reply.data;
    expect(detail.position.jd_text.length).toBeGreaterThan(10_000);
  });

  it("answers the page's real request shapes: the decoder's payloads, run through the reader", () => {
    for (const filters of [
      { limit: 50, offset: 0, sort: "found_at", dir: "desc", scoredOnly: true, hideExcluded: true },
      { q: "role 7", limit: 25, offset: 0, sort: "score", dir: "asc" },
      { statuses: ["scored"], sources: ["board-1"], scoreBands: [{ lo: 50.5, hi: 99.5 }], limit: 100, offset: 0 },
    ]) {
      expect(ask({ op: "list", filters }).reply.ok, JSON.stringify(filters)).toBe(true);
    }
  });
});
