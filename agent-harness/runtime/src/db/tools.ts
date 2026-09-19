/**
 * The SCOUT's database skills as native tools.
 *
 * `db_query`, `db_insert`, `db_update` and `scout_dedup` take the words an
 * agent types after the Python script's name and answer with what the script
 * prints, so the skills' instructions hold word for word (`argv.ts`). Each
 * subcommand is a port of the Python, judged against it in the tests.
 *
 * Only what the SCOUT's own skills do is here (SC-03): it inserts positions,
 * marks one of its own duplicates excluded, and reads. Every other
 * subcommand of the Python scripts belongs to another role and is refused
 * with the reason. SQL is constant with bound parameters everywhere; nothing
 * the model writes names a table or a column. The database path is the
 * runtime's (`jobsDbPath`), never an argument.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { z } from "zod";

import type { ToolExecution, ToolHandler } from "../tools/registry.ts";
import { ArgvError, destOf, parseArgv, pyRepr, type CommandSpec, type Parsed } from "./argv.ts";
import { dbQuery } from "./db-query.ts";
import { checkDuplicate, type Duplicate } from "./dedup.ts";
import { EXTERNAL_INLINE_FIELDS, flattenExternalValue } from "./external-content.ts";
import type { Database } from "./jobs-db.ts";
import { interpretEscapes, pyJson, pySlice, pythonIsoUtc, pyTruthy } from "./py-format.ts";

export interface DbToolsOptions {
  /** The team's database, opened by the runtime on first use. */
  db: () => Database;
  /** This agent's name: the actor of every state transition it writes. */
  agent: string;
  /** `scout-dedup.log`, where each skipped duplicate is appended. Absent: not logged. */
  dedupLog?: string;
  now?: () => Date;
  /** The fence's nonce, for tests that compare with the Python. Absent: a new random one per call. */
  nonce?: () => string;
}

/** What a script run comes to: its output and its exit code. */
export interface ScriptResult {
  stdout: string;
  stderr?: string;
  exitCode: number;
}

const ARGS = z
  .object({
    args: z
      .array(z.string().max(200_000))
      .max(80)
      .describe('The words after the script name, one per item: ["check-url", "4381470286"].'),
  })
  .strict();

export const DB_TOOL_NAMES = ["db_query", "db_insert", "db_update", "scout_dedup"] as const;

export function createDbTools(options: DbToolsOptions): ToolHandler[] {
  const now = options.now ?? (() => new Date());

  const tool = (
    name: string,
    script: string,
    description: string,
    run: (args: string[]) => ScriptResult,
    /** Exit codes that are an answer, not a failure: scout_dedup's 10 means "skip". */
    okCodes: number[] = [0],
  ): ToolHandler => ({
    spec: {
      name,
      description: `${description} Same arguments and output as \`python3 /app/shared/skills/${script}\`: pass the words after the script name as \`args\`.`,
      schema: ARGS,
    },
    // The database is the team's shared state, reached only through these
    // subcommands, each of which enforces what the SCOUT may do; no file of
    // the person's, no network, no process.
    classify: (args) => ({ risk: "none", paths: [], summary: (args as { args: string[] }).args.slice(0, 2).join(" ") }),
    async execute(args) {
      return asExecution(guarded(() => run((args as { args: string[] }).args)), okCodes);
    },
  });

  const logSkip = (dup: Duplicate, input: { url?: string | null; company?: string | null; title?: string | null }) => {
    if (!options.dedupLog) return;
    try {
      mkdirSync(dirname(options.dedupLog), { recursive: true });
      const entry = {
        ts: pythonIsoUtc(now()),
        scout: options.agent,
        level: dup.level,
        existing_id: dup.row.id,
        skipped_url: input.url || "",
        company: input.company || "",
        title: input.title || "",
      };
      appendFileSync(options.dedupLog, `${pyJson(entry)}\n`, "utf8");
    } catch {
      // As in the Python: the log never blocks the answer.
    }
  };

  const dbInsert = (argv: string[]): ScriptResult => {
    const entity = argv[0];
    if (entity !== "position") return refused("db_insert", entity, ["position"]);
    const a = parseArgv(POSITION_INSERT, argv.slice(1));
    for (const field of EXTERNAL_INLINE_FIELDS) {
      if (typeof a[field] === "string") a[field] = flattenExternalValue(a[field]);
    }

    const db = options.db();
    db.exec("BEGIN IMMEDIATE");
    let positionId: number;
    let companyId: number | null;
    try {
      const dup = checkDuplicate(db, {
        url: a["url"] as string,
        company: a["company"] as string,
        title: a["title"] as string,
        location: a["location"] as string | null,
      });
      if (dup) {
        logSkip(dup, { url: a["url"] as string, company: a["company"] as string, title: a["title"] as string });
        db.exec("ROLLBACK");
        return {
          stdout: `⚠\ufe0f  DUPLICATE (${dup.matchType}): '${a["company"]} — ${a["title"]}' already exists as #${dup.row.id} (${dup.row.company} — ${dup.row.title}). INSERT aborted.\n`,
          exitCode: 1,
        };
      }
      companyId = resolveCompanyId(db, a["company"] as string);
      const inserted = db
        .prepare(
          `INSERT INTO positions (title, company, company_id, location,
                                   remote_type,
                                   salary_declared_min, salary_declared_max, salary_declared_currency,
                                   salary_estimated_min, salary_estimated_max, salary_estimated_currency,
                                   salary_estimated_source,
                                   url, source, jd_text, requirements,
                                   found_by, deadline, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          sql(a["title"]),
          sql(a["company"]),
          companyId,
          sql(a["location"]),
          sql(a["remote_type"]),
          sql(a["salary_declared_min"]),
          sql(a["salary_declared_max"]),
          sql(a["salary_declared_currency"]) || "EUR",
          sql(a["salary_estimated_min"]),
          sql(a["salary_estimated_max"]),
          sql(a["salary_estimated_currency"]) || "EUR",
          sql(a["salary_estimated_source"]),
          sql(a["url"]),
          sql(a["source"]),
          sql(a["jd_text"]),
          sql(a["requirements"]),
          sql(a["found_by"]),
          sql(a["deadline"]),
          sql(a["notes"]),
        );
      positionId = Number(inserted.lastInsertRowid);
      // Python: JHT_AGENT_NAME or --found-by or 'unknown'. The harness always knows the agent.
      db.prepare(
        "INSERT INTO position_state_transitions (position_id, from_state, to_state, by_agent, notes) VALUES (?, NULL, 'new', ?, ?)",
      ).run(positionId, options.agent || (a["found_by"] as string | null) || "unknown", "initial INSERT");
      db.exec("COMMIT");
    } catch (error) {
      rollbackQuietly(db);
      if (/UNIQUE/i.test(String((error as Error).message))) {
        return {
          stdout: `⚠\ufe0f  DUPLICATE (URL already exists, UNIQUE constraint): '${a["company"]} — ${a["title"]}' — ${a["url"]}. INSERT aborted.\n`,
          exitCode: 1,
        };
      }
      throw error;
    }
    const cidInfo = companyId ? ` (company_id=${companyId})` : " (company_id=NULL — company not found in DB)";
    return { stdout: `Position inserted with ID: ${positionId}${cidInfo}\n`, exitCode: 0 };
  };

  const dbUpdate = (argv: string[]): ScriptResult => {
    const entity = argv[0];
    if (entity !== "position") return refused("db_update", entity, ["position"]);
    const a = parseArgv(POSITION_UPDATE, argv.slice(1));
    const id = a["id"] as number;
    // SC-03: the SCOUT's one update is marking its own duplicate excluded.
    // The Python lets any caller set any field; this tool lets through only
    // what the SCOUT's skill does, and says so.
    const other = POSITION_UPDATE.options!.map((o) => destOf(o.flag)).filter((k) => k !== "status" && k !== "notes" && a[k] !== null);
    if (other.length > 0 || (a["status"] !== null && a["status"] !== "excluded")) {
      const what = other.length > 0 ? other.map((k) => `--${k.replaceAll("_", "-")}`).join(", ") : `--status ${a["status"]}`;
      return {
        stdout: "",
        stderr: `${what}: not available to this agent. The SCOUT's only update is the duplicate recovery: db_update position <ID> --status excluded --notes "DUPLICATE of #<ORIGINAL_ID>" (skill position-insert).\n`,
        exitCode: 1,
      };
    }
    const status = a["status"] as string | null;
    const notes = a["notes"] as string | null;
    if (!pyTruthy(status) && !pyTruthy(notes)) return { stdout: "No fields to update.\n", exitCode: 0 };

    const changed: string[] = [];
    const db = options.db();
    db.exec("BEGIN IMMEDIATE");
    try {
      const current = db.prepare("SELECT status FROM positions WHERE id = ?").get(id) as { status: string | null } | undefined;
      if (current && current.status !== "new") {
        db.exec("ROLLBACK");
        return {
          stdout: "",
          stderr: `Position #${id} is '${current.status}': it has moved downstream, and the SCOUT only touches positions still 'new'.\n`,
          exitCode: 1,
        };
      }
      const sets: string[] = [];
      const params: Array<string | number | null> = [];
      if (pyTruthy(status)) {
        sets.push("status = ?");
        params.push(status);
        changed.push(`status=${status}`);
      }
      if (pyTruthy(notes)) {
        sets.push("notes = ?");
        params.push(interpretEscapes(notes!));
        changed.push(`notes=${pySlice(notes!, 0, 40)}...`);
      }
      sets.push("last_actor = ?");
      params.push(options.agent);
      // The SET list is made of the constant fragments above; every value is bound.
      const result = db.prepare(`UPDATE positions SET ${sets.join(", ")} WHERE id = ?`).run(...params, id);
      if (Number(result.changes) === 0) {
        db.exec("ROLLBACK");
        return { stdout: `⚠\ufe0f  ERROR: no position found with id=${id}!\n`, exitCode: 1 };
      }
      if (pyTruthy(status) && current?.status !== status) {
        db.prepare(
          "INSERT INTO position_state_transitions (position_id, from_state, to_state, by_agent, notes) VALUES (?, ?, ?, ?, ?)",
        ).run(id, current?.status ?? null, status, options.agent, notes);
      }
      db.exec("COMMIT");
    } catch (error) {
      rollbackQuietly(db);
      throw error;
    }
    return { stdout: `Position ${id} updated: ${changed.join(", ")}\n`, exitCode: 0 };
  };

  const scoutDedup = (argv: string[]): ScriptResult => {
    const sub = argv[0];
    if (sub === undefined) return argparseError("scout_dedup.py", "the following arguments are required: cmd");
    if (sub !== "check") return argparseError("scout_dedup.py", `argument cmd: invalid choice: ${pyRepr(sub)} (choose from 'check')`);
    const a = parseArgv(DEDUP_CHECK, argv.slice(1));
    const input = {
      url: a["url"] as string,
      company: a["company"] as string | null,
      title: a["title"] as string | null,
      location: a["location"] as string | null,
    };
    if (!(pyTruthy(input.url) || (pyTruthy(input.company) && pyTruthy(input.title)))) {
      return { stdout: `${pyJson({ action: "error", reason: "provide --url, or both --company and --title" }, { ensureAscii: false })}\n`, exitCode: 2 };
    }
    // Unlike db_insert, the Python checks the values as given, without flattening them.
    const dup = checkDuplicate(options.db(), input);
    if (!dup) return { stdout: `${pyJson({ action: "insert" }, { ensureAscii: false })}\n`, exitCode: 0 };
    logSkip(dup, input);
    const skip = { action: "skip", level: dup.level, existing_id: dup.row.id, match: dup.matchType };
    return { stdout: `${pyJson(skip, { ensureAscii: false })}\n`, exitCode: 10 };
  };

  return [
    tool(
      "db_query",
      "db_query.py",
      "Read the team's database: check-url, position, positions, recent-activity.",
      (argv) => dbQuery(options.db, argv, options.nonce?.(), (sub) => refused("db_query", sub, ["check-url", "position", "positions", "recent-activity"])),
    ),
    tool(
      "db_insert",
      "db_insert.py",
      "Insert a position you found into the team's database, after the duplicate check (skill position-insert).",
      dbInsert,
    ),
    tool(
      "db_update",
      "db_update.py",
      "Mark a duplicate you inserted as excluded: position <ID> --status excluded --notes (skill position-insert).",
      dbUpdate,
    ),
    tool(
      "scout_dedup",
      "scout_dedup.py",
      "Check whether a position is already in the database before inserting it (SC-05). Exit code 10 means skip.",
      scoutDedup,
      [0, 10],
    ),
  ];
}

/** `db_insert.py position`'s arguments, flag for flag. */
const POSITION_INSERT: CommandSpec = {
  prog: "db_insert.py position",
  options: [
    { flag: "--title", required: true },
    { flag: "--company", required: true },
    { flag: "--location" },
    { flag: "--remote-type", choices: ["full_remote", "hybrid", "onsite"] },
    { flag: "--salary-declared-min", type: "int" },
    { flag: "--salary-declared-max", type: "int" },
    { flag: "--salary-declared-currency", default: "EUR" },
    { flag: "--salary-estimated-min", type: "int" },
    { flag: "--salary-estimated-max", type: "int" },
    { flag: "--salary-estimated-currency", default: "EUR" },
    { flag: "--salary-estimated-source" },
    { flag: "--url", required: true },
    { flag: "--source" },
    { flag: "--jd-text" },
    { flag: "--requirements" },
    { flag: "--found-by" },
    { flag: "--deadline" },
    { flag: "--notes" },
  ],
};

/** A parsed argument as a bound SQL value. Only `store_true` flags are booleans, and none reaches SQL. */
function sql(value: string | number | boolean | null | undefined): string | number | null {
  return typeof value === "boolean" || value === undefined ? null : value;
}

/** `db_update.py position`'s arguments: all of them, so argparse's errors name the same options. */
const POSITION_UPDATE: CommandSpec = {
  prog: "db_update.py position",
  positionals: [{ name: "id", type: "int" }],
  options: [
    { flag: "--status", choices: ["new", "checked", "excluded", "scored", "writing", "review", "ready", "applied", "response"] },
    { flag: "--notes" },
    { flag: "--jd-text" },
    { flag: "--jd-summary" },
    { flag: "--requirements" },
    { flag: "--location" },
    { flag: "--remote-type", choices: ["full_remote", "hybrid", "onsite"] },
    { flag: "--url" },
    { flag: "--deadline" },
    { flag: "--title" },
    { flag: "--company" },
    { flag: "--salary-declared-min" },
    { flag: "--salary-declared-max" },
    { flag: "--salary-declared-currency" },
    { flag: "--salary-estimated-min" },
    { flag: "--salary-estimated-max" },
    { flag: "--salary-estimated-currency" },
    { flag: "--salary-estimated-source" },
    { flag: "--source" },
    { flag: "--last-checked" },
    { flag: "--expires-at" },
    { flag: "--is-open", choices: ["true", "false"] },
    { flag: "--last-open-check" },
    { flag: "--role-family" },
    { flag: "--loc-city" },
    { flag: "--loc-region" },
    { flag: "--loc-country" },
    { flag: "--loc-country-code" },
    { flag: "--loc-continent", choices: ["Europe", "Asia", "Americas", "Africa", "Oceania"] },
    { flag: "--work-mode", choices: ["onsite", "hybrid", "remote"] },
    { flag: "--work-country" },
    { flag: "--work-country-code" },
    { flag: "--is-multi-location", choices: ["true", "false"] },
    { flag: "--location-notes" },
    { flag: "--office-lat" },
    { flag: "--office-lon" },
    { flag: "--office-address" },
    { flag: "--office-geocoded", choices: ["true", "false"] },
    { flag: "--office-verified", choices: ["true", "false"] },
    { flag: "--action", choices: ["liveness_check", "geocode", "logo_fetch", "website_fetch", "jd_refresh", "exclude", "rescore"] },
    { flag: "--outcome", choices: ["confirmed_open", "confirmed_closed", "inconclusive", "updated", "unchanged", "unreachable", "skipped", "failed"] },
    { flag: "--evidence-kind", choices: ["http", "api", "manual", "none"] },
    { flag: "--evidence-url" },
    { flag: "--evidence-code" },
    { flag: "--evidence-hash" },
    { flag: "--duration-ms" },
  ],
};

/** `scout_dedup.py check`. */
const DEDUP_CHECK: CommandSpec = {
  prog: "scout_dedup.py check",
  options: [{ flag: "--url", default: "" }, { flag: "--company" }, { flag: "--title" }, { flag: "--location" }],
};

function argparseError(prog: string, message: string): ScriptResult {
  return { stdout: "", stderr: `usage: ${prog} [-h] ...\n${prog}: error: ${message}\n`, exitCode: 2 };
}

/** `_db.resolve_company_id`: the company's id by case-insensitive name, or null. */
function resolveCompanyId(db: Database, name: string | null): number | null {
  if (!name) return null;
  const row = db.prepare("SELECT id FROM companies WHERE LOWER(name) = LOWER(?)").get(name) as { id: number } | undefined;
  return row ? row.id : null;
}

function rollbackQuietly(db: Database): void {
  try {
    db.exec("ROLLBACK");
  } catch {
    // Already closed: the original error is the one that matters.
  }
}

/** A subcommand of another role's: refused with the reason, as a failed run. */
export function refused(tool: string, sub: string | undefined, allowed: string[]): ScriptResult {
  const which = sub ? `\`${tool} ${sub}\`` : `\`${tool}\` without a subcommand`;
  return {
    stdout: "",
    stderr: `${which} is not available to this agent. Available: ${allowed.map((s) => `${tool} ${s}`).join(", ")}. The other subcommands of the Python script belong to other roles.\n`,
    exitCode: 2,
  };
}

/** Argument errors become argparse's exit 2; anything else is the script crashing, exit 1. */
function guarded(run: () => ScriptResult): ScriptResult {
  try {
    return run();
  } catch (error) {
    if (error instanceof ArgvError) return { stdout: "", stderr: `${error.message}\n`, exitCode: 2 };
    return { stdout: "", stderr: `Error: ${(error as Error).message}\n`, exitCode: 1 };
  }
}

function asExecution(result: ScriptResult, okCodes: number[]): ToolExecution {
  const text = `${result.stdout}${result.stderr ?? ""}`.trimEnd();
  const content = result.exitCode === 0 ? text : `${text}${text ? "\n" : ""}(exit code ${result.exitCode})`;
  return { ok: okCodes.includes(result.exitCode), content, details: { exitCode: result.exitCode } };
}

export type { Parsed };
