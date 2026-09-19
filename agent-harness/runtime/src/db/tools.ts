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
import { ArgvError, parseArgv, type CommandSpec, type Parsed } from "./argv.ts";
import { checkDuplicate, type Duplicate } from "./dedup.ts";
import { EXTERNAL_INLINE_FIELDS, flattenExternalValue } from "./external-content.ts";
import type { Database } from "./jobs-db.ts";
import { pyJson, pythonIsoUtc } from "./py-format.ts";

export interface DbToolsOptions {
  /** The team's database, opened by the runtime on first use. */
  db: () => Database;
  /** This agent's name: the actor of every state transition it writes. */
  agent: string;
  /** `scout-dedup.log`, where each skipped duplicate is appended. Absent: not logged. */
  dedupLog?: string;
  now?: () => Date;
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
      return asExecution(guarded(() => run((args as { args: string[] }).args)));
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
          stdout: `⚠️  DUPLICATE (${dup.matchType}): '${a["company"]} — ${a["title"]}' already exists as #${dup.row.id} (${dup.row.company} — ${dup.row.title}). INSERT aborted.\n`,
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
          stdout: `⚠️  DUPLICATE (URL already exists, UNIQUE constraint): '${a["company"]} — ${a["title"]}' — ${a["url"]}. INSERT aborted.\n`,
          exitCode: 1,
        };
      }
      throw error;
    }
    const cidInfo = companyId ? ` (company_id=${companyId})` : " (company_id=NULL — company not found in DB)";
    return { stdout: `Position inserted with ID: ${positionId}${cidInfo}\n`, exitCode: 0 };
  };

  return [
    tool(
      "db_insert",
      "db_insert.py",
      "Insert a position you found into the team's database, after the duplicate check (skill position-insert).",
      dbInsert,
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

function asExecution(result: ScriptResult): ToolExecution {
  const text = `${result.stdout}${result.stderr ?? ""}`.trimEnd();
  const content = result.exitCode === 0 ? text : `${text}${text ? "\n" : ""}(exit code ${result.exitCode})`;
  return { ok: result.exitCode === 0, content, details: { exitCode: result.exitCode } };
}

export type { Parsed };
