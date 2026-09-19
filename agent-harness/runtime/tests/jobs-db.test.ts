import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { JOBS_DB_SCHEMA_VERSION, jobsDbPath, openJobsDb, type Database } from "../src/db/jobs-db.ts";
import { realPath } from "../src/tools/paths.ts";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
const RUNTIME = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA = readFileSync(join(RUNTIME, "src", "db", "schema.sql"), "utf8");

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "jht-jobs-db-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

type MasterRow = { type: string; name: string; tbl_name: string; sql: string | null };

/** What SQLite recorded about a database, in creation order. */
function master(db: Database): MasterRow[] {
  return db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY rowid").all() as MasterRow[];
}

describe("openJobsDb", () => {
  it("creates the whole schema on a new database, with the TUI's connection settings", () => {
    const db = openJobsDb(":memory:");
    const rows = master(db);
    const count = (type: string) => rows.filter((r) => r.type === type && r.sql !== null).length;
    // sqlite_sequence is SQLite's own, created with the first AUTOINCREMENT table;
    // the UNIQUE constraints' automatic indexes have no SQL and are not counted.
    expect([count("table"), count("index"), count("trigger")]).toEqual([24, 44, 23]);
    expect(rows.map((r) => r.name)).toEqual(expect.arrayContaining(["positions", "companies", "scores", "scout_claims"]));
    expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: JOBS_DB_SCHEMA_VERSION });
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    db.close();
  });

  it("creates the file and its folder when missing, and never re-creates an existing one", () => {
    const path = join(root, "db", "jobs.db");
    const first = openJobsDb(path);
    expect(first.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    first.prepare("INSERT INTO companies (name) VALUES (?)").run("Acme");
    first.close();

    const again = openJobsDb(path);
    expect(again.prepare("SELECT name FROM companies").all()).toEqual([{ name: "Acme" }]);
    again.close();
  });

  it("refuses a database from an older schema instead of writing into it", () => {
    const path = join(root, "old.db");
    const old = new DatabaseSync(path);
    old.exec("CREATE TABLE positions (id INTEGER PRIMARY KEY); PRAGMA user_version = 3;");
    old.close();
    expect(() => openJobsDb(path)).toThrow(/schema version 3/);
  });

  it("enforces the schema's own constraints: a score for a position that does not exist is refused", () => {
    const db = openJobsDb(":memory:");
    expect(() => db.prepare("INSERT INTO scores (position_id, total_score) VALUES (?, ?)").run(999, 50)).toThrow(
      /FOREIGN KEY/,
    );
    db.close();
  });
});

describe("jobsDbPath", () => {
  it("is JHT_API_DB when set, else db/jobs.db under the runtime's home", () => {
    const api = join(root, "api");
    expect(jobsDbPath({}, api)).toBe(realPath(join(api, "db", "jobs.db")));
    expect(jobsDbPath({ JHT_API_DB: join(root, "elsewhere", "x.db") }, api)).toMatch(/elsewhere\/x\.db$/);
  });

  it("refuses a path inside an agent's home, also through a symlink", () => {
    const api = join(root, "api");
    mkdirSync(join(api, "agents", "scout-1"), { recursive: true });
    expect(() => jobsDbPath({ JHT_API_DB: join(api, "agents", "scout-1", "jobs.db") }, api)).toThrow(/agent's home/);

    symlinkSync(join(api, "agents", "scout-1"), join(root, "innocent"));
    expect(() => jobsDbPath({ JHT_API_DB: join(root, "innocent", "jobs.db") }, api)).toThrow(/agent's home/);
  });
});

/**
 * The claim the module stands on: a database the harness creates is the one
 * `_db.py` creates. Checked against the `_db.py` that schema.sql names, taken
 * from git, whenever python3 and that commit are at hand.
 */
describe("schema.sql against shared/skills/_db.py", () => {
  const source = /^-- source: \S+ ([0-9a-f]{7,40})$/m.exec(SCHEMA)?.[1];
  const tools = source !== undefined && available("python3", ["--version"]) && available("git", ["cat-file", "-e", `${source}^{commit}`]);

  it.skipIf(!tools)(`matches what ensure_schema() at ${source ?? "?"} creates, row for row`, () => {
    const src = join(root, "src");
    mkdirSync(src);
    const tar = execFileSync("git", ["archive", source!, "shared/skills"], { cwd: join(RUNTIME, "..", ".."), maxBuffer: 64 << 20 });
    execFileSync("tar", ["-x", "-C", src], { input: tar });
    const skills = join(src, "shared", "skills");

    // The file is what the script writes today from that source…
    const dumped = execFileSync("python3", [join(RUNTIME, "scripts", "dump-jobs-schema.py"), skills, `x ${source}`], {
      encoding: "utf8",
    });
    const body = (text: string) => text.replace(/^-- source: .*$/m, "");
    expect(body(dumped)).toBe(body(SCHEMA));

    // …and a database built from it is the database Python builds.
    const pyPath = join(root, "py.db");
    execFileSync(
      "python3",
      ["-c", "import sys; sys.path.insert(0, sys.argv[1]); import _db; c = _db.get_db(); _db.ensure_schema(c); c.commit()", skills],
      { env: { ...process.env, JHT_DB: pyPath } },
    );
    const py = new DatabaseSync(pyPath);
    const ours = openJobsDb(":memory:");
    expect(master(ours)).toEqual(master(py));
    expect(ours.prepare("PRAGMA user_version").get()).toEqual(py.prepare("PRAGMA user_version").get());
    py.close();
    ours.close();
  });
});

function available(command: string, args: string[]): boolean {
  try {
    execFileSync(command, args, { cwd: RUNTIME, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
