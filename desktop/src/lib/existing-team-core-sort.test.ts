import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readerOnDatabase } from "./existing-team-reader-fixture";

// The reader the core runs on the team's VPS (POSITIONS_READ_PY in
// src-tauri/src/existing_team_runtime.rs), run for real on a database shaped
// like the team's: legacy_id is NULL on every row (the real records have none),
// so the ID the table shows is the row's own id. Every column the Positions
// page lets the person sort by must come back ascending for `asc` and
// descending for `desc`, nulls last either way. Synthetic rows only.
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
  found_at text, salary_declared_min real, salary_declared_max real, salary_declared_currency text);
create table scores(id integer primary key, position_id integer, total_score real);
create table applications(id integer primary key, position_id integer, critic_score real, critic_verdict text,
  written_at text, applied_at text);
""")
# ids and values are deliberately not in found_at order, and mix upper and lower case
ids = [2361, 2307, 2344, 2334, 2337, 2310, 2399, 2302, 2355, 2321, 2330, 2315]
for n, pid in enumerate(ids):
    k = (n * 5) % 12  # a permutation of 0..11, unrelated to the id order
    null = n in (3, 8)
    db.execute("insert into positions values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (
        pid, None,
        ("Role %s" if k % 2 else "role %s") % chr(65 + k), ("Co %s" if k % 3 else "co %s") % chr(90 - k), None,
        None if null else "City %02d" % k, None if null else ["full_remote", "hybrid", "onsite"][k % 3],
        ["new", "scored", "ready", "applied"][k % 4], None if null else "board-%d" % (k % 5),
        None if null else "Family %d" % (k % 6), None if null else "C%d" % (k % 4), None if null else "Town %d" % k,
        "2026-01-%02dT10:00:00Z" % (1 + k), None if null else 30000.0 + 1000 * k, None, None if null else "EUR"))
    if not null:
        db.execute("insert into scores values(?,?,?)", (pid, pid, 40.0 + k))
        db.execute("insert into applications values(?,?,?,?,?,?)", (pid, pid, float(k % 10), "PASS",
            "2026-02-%02dT10:00:00Z" % (1 + k) if k % 2 else None, "2026-03-%02dT10:00:00Z" % (1 + k) if k % 3 == 0 else None))
db.commit()
`;

// Each sortable column of the page, and the field of the core's row that holds its value.
const COLUMNS: Array<[sort: string, field: string]> = [
  ["id", "id"],
  ["title", "title"],
  ["company", "company"],
  ["role_family", "role_family"],
  ["source", "source"],
  ["location", "location"],
  ["loc_city", "loc_city"],
  ["loc_country", "loc_country"],
  ["remote", "remote_type"],
  ["score", "score"],
  ["salary", "salary_min"],
  ["monthly", "salary_min"],
  ["critic", "critic_score"],
  ["found_at", "found_at"],
  ["status", "status"],
  ["written_at", "written_at"],
  ["applied_at", "applied_at"],
];

let dir = "";
let reader = "";

function rows(filters: Record<string, unknown>): Array<Record<string, any>> {
  const run = spawnSync("python3", ["-I", reader], { input: `${JSON.stringify({ op: "list", filters })}\n` });
  expect(run.status, String(run.stderr)).toBe(0);
  const reply = JSON.parse(run.stdout.toString("utf8"));
  expect(reply.ok, JSON.stringify(reply)).toBe(true);
  return reply.data.items;
}

const comparable = (value: unknown) => (typeof value === "string" ? value.toLowerCase() : (value as number));

beforeAll(() => {
  if (!available) return;
  dir = mkdtempSync(join(tmpdir(), "jht-core-sort-"));
  const database = join(dir, "jobs.db");
  expect(spawnSync("python3", ["-I", "-c", SETUP, database]).status).toBe(0);
  reader = join(dir, "reader.py");
  writeFileSync(reader, readerOnDatabase(READER, database));
});
afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!available)("the core sorts the list both ways on rows without a legacy id", () => {
  it.each(COLUMNS)("%s: asc is ascending, desc is descending, nulls last", (sort, field) => {
    for (const dirName of ["asc", "desc"] as const) {
      const items = rows({ sort, dir: dirName, limit: 50 });
      expect(items).toHaveLength(12);
      const values = items.map((row) => (sort === "id" ? Number(row.id) : row[field]));
      const present = values.filter((value) => value != null).map(comparable);
      // nulls never come before a value
      expect(values.findIndex((value) => value == null) === -1 ||
        values.slice(values.findIndex((value) => value == null)).every((value) => value == null)).toBe(true);
      expect(present.length).toBeGreaterThanOrEqual(3);
      const ordered = [...present].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      expect(present, `${sort} ${dirName}`).toEqual(dirName === "asc" ? ordered : [...ordered].reverse());
    }
    const asc = rows({ sort, dir: "asc", limit: 50 }).map((row) => row.id);
    const desc = rows({ sort, dir: "desc", limit: 50 }).map((row) => row.id);
    expect(asc, `${sort}: asc and desc must differ`).not.toEqual(desc);
  });

  it("sorts by the ID the table shows: the legacy id when the row has one, else its own id", () => {
    const asc = rows({ sort: "id", dir: "asc", limit: 50 }).map((row) => Number(row.id));
    expect(asc).toEqual([...asc].sort((a, b) => a - b));
    expect(asc[0]).toBe(2302);
    const desc = rows({ sort: "id", dir: "desc", limit: 50 }).map((row) => Number(row.id));
    expect(desc[0]).toBe(2399);
  });

  it("keeps the page window and the order together: page 2 of an ascending sort", () => {
    const all = rows({ sort: "id", dir: "asc", limit: 50 }).map((row) => row.id);
    const second = rows({ sort: "id", dir: "asc", limit: 5, offset: 5 }).map((row) => row.id);
    expect(second).toEqual(all.slice(5, 10));
  });
});
