/**
 * The team's database, `jobs.db`, as the harness opens it.
 *
 * The TUI agents keep every position, score and application in one SQLite
 * file created by `shared/skills/_db.py`. An API agent must read and write
 * the same rows with the same meaning, so the harness does not design a
 * schema of its own: `schema.sql` is what `_db.py`'s `ensure_schema()` leaves
 * in `sqlite_master`, dumped by `scripts/dump-jobs-schema.py`, and a new
 * jobs.db is created by executing it. The tools built on this module run
 * only constant SQL with bound parameters; nothing a model writes becomes SQL.
 *
 * Where the file lives is the runtime's decision, never a tool's: see
 * `jobsDbPath`.
 */

import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { DatabaseSync as Database } from "node:sqlite";

import { HarnessError } from "../core/errors.ts";
import { isInside, realPath, resolveUserPath } from "../tools/paths.ts";

/**
 * `node:sqlite` exists only under its `node:` name, and Vite (under vitest)
 * strips that prefix from static imports; a runtime `require` keeps it.
 */
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
export type { Database };

/** `PRAGMA user_version` of the schema in `schema.sql`. An older file is refused, not migrated. */
export const JOBS_DB_SCHEMA_VERSION = schemaVersion();

/** `_db.py` connects with `timeout=10`: a writer waits this long for a lock, then fails. */
const BUSY_TIMEOUT_MS = 10_000;

/**
 * Where jobs.db is: `JHT_API_DB` when set, else `<apiHome>/db/jobs.db`.
 *
 * Read once by the runtime at start-up and handed to `openJobsDb`; no tool
 * takes a path to it. Symlinks are resolved, so the answer is the file that
 * will really be opened, and it may not sit in any agent's home: every role
 * shares this file, and a home is one role's to write.
 */
export function jobsDbPath(env: Record<string, string | undefined>, apiHome: string): string {
  const raw = env["JHT_API_DB"]?.trim();
  const path = realPath(raw ? resolveUserPath(raw, process.cwd(), homedir()) : join(apiHome, "db", "jobs.db"));
  const agents = realPath(join(apiHome, "agents"));
  if (isInside(agents, path)) {
    throw new HarnessError(
      "config_invalid",
      `JHT_API_DB points inside ${agents}: the team's database cannot live in an agent's home.`,
    );
  }
  return path;
}

/**
 * Opens jobs.db, creating the file and the whole schema when it is new.
 *
 * An existing file is used as it is, with the connection settings `_db.py`
 * uses (WAL, foreign keys on, a 10 s lock wait). A file that has tables but
 * an older schema version is refused: migrating it is `_db.py`'s job, and a
 * half-understood schema would write rows the TUI agents misread.
 * `:memory:` gives a fresh database for tests.
 */
export function openJobsDb(path: string): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  try {
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");

    const tables = db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'").get() as { n: number };
    if (tables.n === 0) {
      db.exec("BEGIN");
      try {
        db.exec(readSchema());
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }

    const { user_version: version } = db.prepare("PRAGMA user_version").get() as { user_version: number };
    if (version < JOBS_DB_SCHEMA_VERSION) {
      throw new HarnessError(
        "config_invalid",
        `${path} has schema version ${version}; the harness needs ${JOBS_DB_SCHEMA_VERSION}. ` +
          "Open it once with the TUI's shared/skills/_db.py to migrate it.",
      );
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function readSchema(): string {
  return readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
}

function schemaVersion(): number {
  const match = /^PRAGMA user_version = (\d+);$/m.exec(readSchema());
  if (!match?.[1]) throw new Error("schema.sql does not set user_version: regenerate it.");
  return Number(match[1]);
}
