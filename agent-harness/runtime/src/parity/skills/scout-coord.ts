/**
 * `shared/skills/scout_coord.py` as a native tool: how Scouts split circles
 * and sources, and claim a position so two of them never work the same one.
 *
 * Same subcommands, same effect on `jobs.db` (`scout_coordination`,
 * `scout_claims`), same printed lines — the Scout's prompt reads `AVAILABLE`,
 * `CLAIMED by …`, `ALREADY_CLAIMED …` and acts on them. What the TUI script
 * reports on stderr with exit 3 (the database is unusable) comes back as a
 * failed call with the same message.
 *
 * Bound to the Scout that runs it (SICUREZZA §7 D-2). The script takes any
 * name, so one Scout could claim or assign in another's name, or close every
 * Scout's split. Here `assign` and `claim` act only for the calling agent —
 * `scout` may be omitted, and naming someone else is refused — and `reset`
 * closes only the caller's own split and old claims. The lowest-numbered
 * Scout no longer resets the others: each resets itself. No other role has
 * the tool (only the Scout lists `scout-coord`), so none needs an exception.
 *
 * Left out, on purpose:
 * - `bootstrap` runs in the TUI launcher before any Scout, and imports a
 *   legacy file this runtime never had; the runtime opens the database itself.
 * - the database path is the runtime's (`jobs-db.ts`), never an argument: a
 *   model cannot point the tool at another file.
 *
 * Every statement is a constant with bound parameters.
 */

import type { Database } from "../../db/jobs-db.ts";

import { z } from "zod";

import type { ToolExecution, ToolHandler } from "../../tools/registry.ts";
import { printed, pyJson, pyNowIso, pyStr } from "./py-compat.ts";

export const SCOUT_COORD_TOOL = "scout_coord";

/** `scout-1`, `scout-2`: what `assign` accepts as a Scout's name. */
const SCOUT_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const DB_ORIGIN = "jobs_db";

export interface ScoutCoordOptions {
  /** The agent running the tool: `scout-1`. Every write is in this name. */
  agent: string;
  /** Opens the team database. The runtime decides which file; the tool never does. */
  db: () => Database;
  /** The database file, for `doctor` to report. */
  dbPath: string;
  now?: () => Date;
}

type Row = Record<string, unknown>;

class CoordinationDbError extends Error {}

const schema = z
  .object({
    command: z.enum(["show", "history", "assign", "reset", "claim", "check-claim", "doctor"]),
    scout: z.string().min(1).max(64).optional().describe("assign, claim: your own name (the default); another Scout's is refused"),
    cerchi: z.string().max(200).optional().describe('assign: circles, e.g. "1,2"'),
    fonti: z.string().max(500).optional().describe('assign: source slugs, e.g. "linkedin,greenhouse"'),
    note: z.string().max(1_000).optional().describe("assign: a note"),
    job_id: z.string().min(1).max(500).optional().describe("claim, check-claim: the position's id or URL"),
    json: z.boolean().optional().describe("doctor: JSON instead of text"),
  })
  .strict();

type Args = z.infer<typeof schema>;

export function createScoutCoordTool(options: ScoutCoordOptions): ToolHandler {
  const now = options.now ?? (() => new Date());
  const me = options.agent.trim().toLowerCase();
  if (!SCOUT_NAME.test(me)) throw new Error(`scout_coord needs a Scout's name for its agent, not '${options.agent}'.`);

  /** The Scout a write is for: the caller, whether it named itself or not. Null for anyone else. */
  const self = (scout: string | undefined): string | null =>
    scout === undefined || scout.trim().toLowerCase() === me ? me : null;
  const notYours = (scout: string, what: string) =>
    usage(
      `you are ${me}: you can ${what} only in your own name, not '${scout}'. ` +
        "Nothing was written. Ask that Scout to do it, or agree the split with them by message.",
    );

  const actionable = (detail: string) =>
    `scout coordination unusable in ${options.dbPath}: ${detail}. ` +
    "That file is the team database (JHT_DB): fix the path or the permissions. " +
    "Do NOT create a database of your own — two Scouts on two files are not coordinating, they only believe they are.";

  const open = (): Database => {
    try {
      return options.db();
    } catch (error) {
      throw new CoordinationDbError(actionable(error instanceof Error ? error.message : String(error)));
    }
  };

  const commands: Record<Args["command"], (args: Args) => ToolExecution> = {
    show() {
      const rows = open()
        .prepare("SELECT * FROM scout_coordination WHERE superseded_at IS NULL ORDER BY scout")
        .all() as Row[];
      if (rows.length === 0) return ok(["No active distribution."]);
      const out = [`=== ACTIVE DISTRIBUTION (since ${pyStr(rows[0]!["started_at"])}) ===`, ""];
      for (const r of rows) {
        out.push(`  ${pyStr(r["scout"])}`);
        out.push(`    Search areas: ${orDash(r["cerchi"])}`);
        out.push(`    Sources:      ${orDash(r["fonti"])}`);
        if (r["note"]) out.push(`    Note:   ${pyStr(r["note"])}`);
        out.push("");
      }
      return ok(out);
    },

    history() {
      const rows = open()
        .prepare("SELECT * FROM scout_coordination ORDER BY started_at DESC, scout")
        .all() as Row[];
      if (rows.length === 0) return ok(["No history."]);
      const out: string[] = [];
      let session: unknown;
      for (const r of rows) {
        if (r["started_at"] !== session) {
          session = r["started_at"];
          const status = r["superseded_at"] === null ? "ACTIVE" : `closed ${pyStr(r["superseded_at"])}`;
          out.push("", `--- Session ${pyStr(r["started_at"])} (${status}) ---`);
        }
        const active = r["superseded_at"] === null ? " *" : "";
        out.push(`  ${pyStr(r["scout"])}: areas=${orDash(r["cerchi"])}, sources=${orDash(r["fonti"])}${active}`);
      }
      return ok(out);
    },

    assign({ scout: named, cerchi, fonti, note }) {
      // An assignment owned by a typo shows up as a participant in the split.
      if (named !== undefined && !SCOUT_NAME.test(named.trim().toLowerCase())) {
        throw new CoordinationDbError(
          `'${named}' is not a Scout name (expected something like \`scout-1\`). Nothing was written: ` +
            "an assignment owned by a typo would show up as a participant in the split.",
        );
      }
      const scout = self(named);
      if (scout === null) return notYours(named!, "assign circles and sources");
      const db = open();
      const existing = db
        .prepare("SELECT id FROM scout_coordination WHERE scout=? AND superseded_at IS NULL")
        .get(scout) as Row | undefined;
      const values = [cerchi ?? null, fonti ?? null, note ?? null] as const;
      if (existing) {
        // `started_at` is never touched: it is half of the (scout, started_at) unique key.
        db.prepare("UPDATE scout_coordination SET cerchi=?, fonti=?, note=? WHERE id=?").run(...values, existing["id"] as number);
        return ok([`Updated: ${scout} → search_areas=${pyStr(cerchi)}, sources=${pyStr(fonti)}`]);
      }
      db.prepare("INSERT INTO scout_coordination (scout, cerchi, fonti, note) VALUES (?, ?, ?, ?)").run(scout, ...values);
      return ok([`Assigned: ${scout} → search_areas=${pyStr(cerchi)}, sources=${pyStr(fonti)}`]);
    },

    reset() {
      const db = open();
      // Only the caller's own split and claims: a Scout never closes a peer's.
      const updated = db
        .prepare("UPDATE scout_coordination SET superseded_at=? WHERE superseded_at IS NULL AND scout=?")
        .run(pyNowIso(now()), me).changes;
      // Claims older than a day go with the session.
      db.prepare("DELETE FROM scout_claims WHERE claimed_at < datetime('now', '-24 hours') AND scout=?").run(me);
      return ok([`Session closed: ${updated} assignments archived.`]);
    },

    claim({ job_id, scout: named }) {
      if (job_id === undefined) return usage("claim needs job_id.");
      if (named !== undefined && !SCOUT_NAME.test(named.trim().toLowerCase())) {
        return usage(`'${named}' is not a Scout name (expected something like \`scout-1\`). Nothing was claimed.`);
      }
      const scout = self(named);
      if (scout === null) return notYours(named!, "claim a position");
      const db = open();
      const existing = db.prepare("SELECT scout, claimed_at FROM scout_claims WHERE job_id=?").get(job_id) as Row | undefined;
      if (existing) return ok([`ALREADY_CLAIMED by ${pyStr(existing["scout"])} at ${pyStr(existing["claimed_at"])}`]);
      try {
        db.prepare("INSERT INTO scout_claims (job_id, scout) VALUES (?, ?)").run(job_id, scout);
      } catch (error) {
        // The primary key is the lock: a peer inserted between the SELECT and here.
        if (isConstraint(error)) return ok(["ALREADY_CLAIMED (race condition)"]);
        throw error;
      }
      return ok([`CLAIMED by ${scout}`]);
    },

    "check-claim"({ job_id }) {
      if (job_id === undefined) return usage("check-claim needs job_id.");
      const existing = open().prepare("SELECT scout, claimed_at FROM scout_claims WHERE job_id=?").get(job_id) as
        | Row
        | undefined;
      return ok([existing ? `CLAIMED by ${pyStr(existing["scout"])} at ${pyStr(existing["claimed_at"])}` : "AVAILABLE"]);
    },

    doctor({ json }) {
      const report: Record<string, unknown> = {
        path: options.dbPath,
        origin: DB_ORIGIN,
        exists: true,
        writable: false,
        assignments: null,
        claims: null,
        error: null,
        legacy_db: null,
      };
      try {
        const db = open();
        // Writable means a write lock can be taken, not that the file opens.
        db.exec("BEGIN IMMEDIATE");
        db.exec("ROLLBACK");
        report["writable"] = true;
        report["assignments"] = (db.prepare("SELECT COUNT(*) AS n FROM scout_coordination WHERE superseded_at IS NULL").get() as Row)["n"];
        report["claims"] = (db.prepare("SELECT COUNT(*) AS n FROM scout_claims").get() as Row)["n"];
      } catch (error) {
        report["error"] = error instanceof Error ? error.message : String(error);
      }
      if (json) return { ok: report["writable"] === true, content: pyJson(report, { ensureAscii: false }) };
      const lines = [
        `database: ${options.dbPath}`,
        `origin:   ${DB_ORIGIN} (the team database — same JHT_DB as every other skill)`,
        `exists:   ${pyStr(report["exists"])}    writable: ${pyStr(report["writable"])}`,
        `active assignments: ${pyStr(report["assignments"])}   claims: ${pyStr(report["claims"])}`,
        ...(report["error"] ? [String(report["error"])] : []),
      ];
      return { ok: report["writable"] === true, content: printed(lines) };
    },
  };

  return {
    spec: {
      name: SCOUT_COORD_TOOL,
      description:
        "The Scouts' coordination in the team database (replaces `python3 …/scout_coord.py`). " +
        "show: the active split. history: past splits. assign: record your circles and sources (scout, cerchi, fonti, note). " +
        "reset: close your own current split. claim: take a position before working it (job_id). " +
        "assign and claim are always in your own name. " +
        "check-claim: is a position taken (job_id). doctor: which database, and is it writable.",
      schema,
    },

    classify(args) {
      const { command } = args as Args;
      const writes = command === "assign" || command === "reset" || command === "claim";
      // The database is the runtime's, not a path the model chose: nothing to list.
      return { risk: writes ? "write" : "read", paths: [], summary: `scout_coord ${command}` };
    },

    async execute(args) {
      const parsed = args as Args;
      try {
        return commands[parsed.command](parsed);
      } catch (error) {
        if (error instanceof CoordinationDbError) return { ok: false, content: error.message };
        return { ok: false, content: actionable(error instanceof Error ? error.message : String(error)) };
      }
    },
  };
}

function orDash(value: unknown): string {
  return value === null || value === undefined || value === "" ? "-" : pyStr(value);
}

function ok(lines: string[]): ToolExecution {
  return { ok: true, content: printed(lines) };
}

function usage(message: string): ToolExecution {
  return { ok: false, content: `Error: ${message}` };
}

/** SQLite's primary-key and unique violations: the extended codes of SQLITE_CONSTRAINT (19). */
function isConstraint(error: unknown): boolean {
  const code = (error as { errcode?: unknown } | null)?.errcode;
  return typeof code === "number" && (code & 0xff) === 19;
}
