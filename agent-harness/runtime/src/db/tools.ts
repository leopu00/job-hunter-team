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
import { insertApplication, insertCompany, insertHighlight } from "./db-insert.ts";
import { dbQuery } from "./db-query.ts";
import type { EnrichmentPolicy } from "./enrichment-policy.ts";
import { EVIDENCE_KINDS, MAINTENANCE_ACTIONS, MAINTENANCE_OUTCOMES, updateApplication, updateCompany, updatePosition } from "./db-update.ts";
import { checkDuplicate, type Duplicate } from "./dedup.ts";
import { EXTERNAL_INLINE_FIELDS, Fence, flattenExternalValue } from "./external-content.ts";
import { agentAliases, agentInstanceId } from "../core/agent-id.ts";
import { AGENT_NAME } from "../parity/jht-tools.ts";
import { dbPolicyFor } from "./role-policy.ts";
import { checkMinimumViableProfile } from "../parity/skills/profile-gate.ts";
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
  /**
   * `candidate_profile.yml`, which `db_insert score` checks before it writes
   * (profile_gate). Absent: no profile, so no score is written.
   */
  profilePath?: string;
  /**
   * Where the browser send flow leaves its checkpoint for a position
   * (`$JHT_HOME/.cache/apply-flow/<id>.json`), read before a CV is replaced.
   * Absent: no such flow on this box, and the send state is the row's.
   */
  checkpoint?: (positionId: number) => string | undefined;
  /** The candidate the category registry is read for; `local`, as `_db.local_user_id()` without JHT_SUPABASE_USER_ID. */
  userId?: string;
  /** The person's enrichment policy, which the care-mode queues obey. */
  policy?: EnrichmentPolicy;
}

/** What a script run comes to: its output and its exit code. */
export interface ScriptResult {
  stdout: string;
  stderr?: string;
  exitCode: number;
}

export const ARGS = z
  .object({
    args: z
      .array(z.string().max(200_000))
      .max(80)
      .describe('The words after the script name, one per item: ["check-url", "4381470286"].'),
  })
  .strict();

export const DB_TOOL_NAMES = ["db_query", "db_insert", "db_update", "scout_dedup"] as const;

export function createDbTools(given: DbToolsOptions): ToolHandler[] {
  // Rows carry the canonical id: an agent started as `scout` and later as
  // `scout-1` finds its own positions both times (agent-id.ts).
  const options: DbToolsOptions = { ...given, agent: agentInstanceId(given.agent) };
  // Rows this agent owns, however an earlier run of it signed them. Exactly
  // two names, bound as parameters: the canonical id, and for instance 1 the
  // bare role name (a single-name agent repeats its id).
  const [ownId, ownAlias = ownId] = agentAliases(options.agent) as [string, string?];
  const owns = (foundBy: string | null) => foundBy !== null && [ownId, ownAlias].includes(foundBy.toLowerCase());
  const now = options.now ?? (() => new Date());
  // What this agent's role may run, subcommand by subcommand (role-policy.ts).
  const policy = dbPolicyFor(options.agent);

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
    if (entity === undefined || !INSERT_ENTITIES.has(entity) || !policy.insert.includes(entity)) {
      return refused("db_insert", entity, [...policy.insert]);
    }
    if (entity === "score") return insertScore(argv.slice(1));
    if (entity === "company") {
      const a = parseArgv(COMPANY_INSERT, argv.slice(1));
      // SICUREZZA A-2: the row says who analyzed it, and that is this agent.
      a["analyzed_by"] = options.agent;
      return insertCompany(options.db(), a);
    }
    if (entity === "highlight") return insertHighlight(options.db(), parseArgv(HIGHLIGHT_INSERT, argv.slice(1)));
    if (entity === "application") {
      const a = parseArgv(APPLICATION_INSERT, argv.slice(1));
      // D-5: the CV's author is the agent the runtime runs, never an argument.
      a["written_by"] = options.agent;
      const id = a["position_id"] as number;
      // The script's INSERT OR REPLACE would wipe a verdict, the send and created_at off a
      // live row. The gate before it (`db_query application`) is what tells a new application
      // from an existing one; here it is the write's own condition.
      if (options.db().prepare("SELECT 1 FROM applications WHERE position_id = ?").get(id) !== undefined) {
        return {
          stdout: "",
          stderr:
            `⚠\ufe0f  APPLICATION EXISTS: position ${id} already has one, and inserting again would erase its ` +
            "verdict, its paths and its send. Check it with `db_query application " +
            `${id}` +
            "` and change it with `db_update application`.\n",
          exitCode: 1,
        };
      }
      return insertApplication(options.db(), a);
    }
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
        // D-4: the existing row's company and title were written by a page; the
        // Python prints them bare, we fence them as db_query does.
        const fence = new Fence(options.nonce?.());
        return {
          stdout: `⚠\ufe0f  DUPLICATE (${dup.matchType}): '${a["company"]} — ${a["title"]}' already exists as #${dup.row.id} (${fence.inline(dup.row.company)} — ${fence.inline(dup.row.title)}). INSERT aborted.\n`,
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
          // D-5: the finder is the agent the runtime runs, not what the model typed in --found-by.
          options.agent,
          sql(a["deadline"]),
          sql(a["notes"]),
        );
      positionId = Number(inserted.lastInsertRowid);
      // Python: JHT_AGENT_NAME or --found-by or 'unknown'. The harness always knows the agent.
      db.prepare(
        "INSERT INTO position_state_transitions (position_id, from_state, to_state, by_agent, notes) VALUES (?, NULL, 'new', ?, ?)",
      ).run(positionId, options.agent, "initial INSERT");
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

  /** `db_insert.py score` (T15): the SCORER's verdict on one position. */
  const insertScore = (argv: string[]): ScriptResult => {
    const a = parseArgv(SCORE_INSERT, argv);
    // The maintenance history (`--action rescore`) is the Mantenitore's, and
    // scorer.md never passes it: a score here is a first score or a plain re-score.
    if (a["action"] !== null && a["action"] !== undefined) {
      return { stdout: "", stderr: "--action: not available to this agent. Score with db_insert score and no maintenance flags.\n", exitCode: 2 };
    }
    // profile_gate.py, before anything else, as insert_score runs it.
    const gate = options.profilePath
      ? checkMinimumViableProfile(options.profilePath)
      : { ok: false, reason: "candidate profile is missing: the runtime has no profile folder" };
    if (!gate.ok) {
      return {
        stdout:
          `⚠\ufe0f  SCORE REJECTED: ${gate.reason}.\n` +
          "    The candidate profile is substantially empty: do not assign a score.\n" +
          "    Leave the position in 'checked' and escalate to the Captain (RULE-T10 — do not invent).\n",
        exitCode: 1,
      };
    }
    for (const [column, maximum] of [["total", SCORE_TOTAL_LIMIT], ...Object.entries(SCORE_COMPONENT_LIMITS)] as const) {
      const value = a[column] as number | null | undefined;
      if (value !== null && value !== undefined && (value < 0 || value > maximum)) {
        return { stdout: `⚠\ufe0f  ERROR: ${column}=${value} is outside range [0-${maximum}]\n`, exitCode: 1 };
      }
    }
    // An upsert, not REPLACE: a re-score keeps scores.id, the row's identity
    // towards the cloud, and deletes nothing (no tombstone for a live score).
    // S-1: only on a position in the SCORER's queue (`checked`, as
    // next-for-scorer reads it), in the same statement: the script would
    // score or rewrite any position, one already in writing or applied too.
    const db = options.db();
    const written = db
      .prepare(
        `INSERT INTO scores (position_id, total_score, stack_match, remote_fit,
                             salary_fit, experience_fit, strategic_fit,
                             breakdown, notes, scored_by, scored_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%d %H:%M:%f', 'now')
         WHERE EXISTS (SELECT 1 FROM positions WHERE id = ? AND status = 'checked')
         ON CONFLICT(position_id) DO UPDATE SET
             total_score = excluded.total_score,
             stack_match = excluded.stack_match,
             remote_fit = excluded.remote_fit,
             salary_fit = excluded.salary_fit,
             experience_fit = excluded.experience_fit,
             strategic_fit = excluded.strategic_fit,
             breakdown = excluded.breakdown,
             notes = excluded.notes,
             scored_by = excluded.scored_by,
             scored_at = excluded.scored_at`,
      )
      .run(
        sql(a["position_id"]),
        sql(a["total"]),
        sql(a["stack_match"]),
        sql(a["remote_fit"]),
        sql(a["salary_fit"]),
        sql(a["experience_fit"]),
        sql(a["strategic_fit"]),
        sql(a["breakdown"]),
        sql(a["notes"]),
        // As --found-by (D-5): the scorer is the agent the runtime runs, not what the model typed.
        options.agent,
        sql(a["position_id"]),
      );
    if (Number(written.changes) === 0) {
      const row = db.prepare("SELECT status FROM positions WHERE id = ?").get(sql(a["position_id"])) as { status: string } | undefined;
      const why = row ? `is '${row.status}', not 'checked'` : "does not exist";
      return {
        stdout: `⚠\ufe0f  SCORE REFUSED: position ${a["position_id"]} ${why}. Score only the positions of your queue (db_query next-for-scorer).\n`,
        exitCode: 1,
      };
    }
    return { stdout: `Score inserted for position ${a["position_id"]}: ${a["total"]}/100\n`, exitCode: 0 };
  };

  const dbUpdate = (argv: string[]): ScriptResult => {
    const entity = argv[0];
    if (entity === undefined || !policy.update.includes(entity)) return refused("db_update", entity, [...policy.update]);
    if (entity === "company") {
      const a = parseArgv(COMPANY_UPDATE, argv.slice(1));
      // SICUREZZA A-2, as D-5 for found_by: who analyzed the company is this agent, never an argument.
      if (a["analyzed_by"] !== null) a["analyzed_by"] = options.agent;
      return updateCompany(options.db(), a, options.agent);
    }
    if (entity === "application") return updateApplicationGuarded(argv.slice(1));
    const rule = policy.position!;
    const a = parseArgv(POSITION_UPDATE, argv.slice(1));
    const id = a["id"] as number;
    const status = a["status"] as string | null;
    const deny = (why: string): ScriptResult => ({ stdout: "", stderr: `${why}\n`, exitCode: 1 });
    // The Python lets any caller set any field and any status; the role's rule
    // lets through what its prompt does, and says why when it does not.
    if (rule.fields !== "*") {
      const allowed = rule.fields;
      const other = POSITION_UPDATE.options!.map((o) => destOf(o.flag)).filter((k) => !allowed.includes(k) && a[k] !== null);
      if (other.length > 0) return deny(`${other.map((k) => `--${k.replaceAll("_", "-")}`).join(", ")}: not available to this agent. ${rule.purpose}`);
    }
    if (pyTruthy(status) && !(status! in rule.moves)) return deny(`--status ${status}: not available to this agent. ${rule.purpose}`);
    for (const [flag, target] of Object.entries(rule.onlyWith ?? {})) {
      if (a[flag] !== null && status !== target) {
        return deny(`--${flag.replaceAll("_", "-")} goes only with --status ${target} for this agent. ${rule.purpose}`);
      }
    }
    // Where the row must stand: the move's own sources, or the role's statuses for any update;
    // and out of the later statuses when a flag is passed that those rows do not take.
    const given = POSITION_UPDATE.options!.map((o) => destOf(o.flag)).filter((k) => a[k] !== null);
    let from: readonly string[] | undefined = pyTruthy(status) ? rule.moves[status!]! : rule.touches;
    const early = rule.later && given.filter((k) => !rule.later!.fields.includes(k));
    if (rule.later && early && early.length > 0) {
      const later = rule.later.statuses;
      from = from?.filter((f) => !later.includes(f));
      const row = options.db().prepare("SELECT status FROM positions WHERE id = ?").get(id) as { status: string | null } | undefined;
      if (row && later.includes(row.status ?? "")) {
        return deny(
          `Position #${id} is '${row.status}': past the analysis this agent may change only ${rule.later.fields.filter((f) => !/^(action|outcome|evidence_|duration)/.test(f)).map((f) => `--${f.replaceAll("_", "-")}`).join(", ")}, not ${early.map((k) => `--${k.replaceAll("_", "-")}`).join(", ")}. ${rule.purpose}`,
        );
      }
    }
    const current = options.db().prepare("SELECT status, found_by FROM positions WHERE id = ?").get(id) as
      | { status: string | null; found_by: string | null }
      | undefined;
    if (current && rule.ownRowsOnly && !owns(current.found_by)) {
      return deny(`Position #${id} was found by ${current.found_by ?? "nobody recorded"}, not by you: the SCOUT only recovers its own duplicates.`);
    }
    if (current && from && !from.includes(current.status ?? "")) {
      const move = pyTruthy(status) ? `to '${status}'` : "at all";
      return deny(`Position #${id} is '${current.status}': this agent updates it ${move} only from ${from.map((f) => `'${f}'`).join(" or ")}. ${rule.purpose}`);
    }
    // A-3: past the analysis, a position is closed only on a recorded proof that it closed.
    const closing = status === "excluded" || a["is_open"] === "false";
    const proof =
      a["action"] === "liveness_check" && a["outcome"] === "confirmed_closed" && (a["evidence_code"] !== null || pyTruthy(a["evidence_url"]));
    if (rule.later && rule.laterCloseNeedsProof && closing && !proof) {
      const later = rule.later.statuses;
      const row = options.db().prepare("SELECT status FROM positions WHERE id = ?").get(id) as { status: string | null } | undefined;
      if (row && later.includes(row.status ?? "")) {
        return deny(
          `Position #${id} is '${row.status}': past the analysis it is closed only on proof. Add --action liveness_check --outcome confirmed_closed and the evidence (--evidence-code <HTTP status> or --evidence-url <URL>) from recheck_liveness, or leave it open.`,
        );
      }
      // Not in the WHERE either: a row that reached a later status meanwhile is not closed without proof.
      from = from?.filter((f) => !later.includes(f));
    }
    // The same conditions in the write itself: a row that changed hands or status meanwhile is not touched.
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (from) {
      where.push(`AND status IN (${from.map(() => "?").join(", ")})`);
      params.push(...from);
    }
    if (rule.ownRowsOnly) {
      where.push("AND lower(found_by) IN (?, ?)");
      params.push(ownId, ownAlias);
    }
    return updatePosition(options.db(), a, options.agent, options.userId ?? "local", { where: where.join(" "), params });
  };

  /**
   * `db_update application` under the role's rule: the flags it may pass, the
   * statuses it may set, and what a status needs beside it — the single-writer
   * rule, where `ready` is the Critic's verdict and not the Writer's opinion.
   */
  const updateApplicationGuarded = (argv: string[]): ScriptResult => {
    const rule = policy.application!;
    const a = parseArgv(APPLICATION_UPDATE, argv);
    const deny = (why: string): ScriptResult => ({ stdout: "", stderr: `${why}\n`, exitCode: 1 });
    const given = APPLICATION_UPDATE.options!.map((o) => destOf(o.flag)).filter((k) => a[k] !== null);
    const other = given.filter((k) => !rule.fields.includes(k));
    if (other.length > 0) return deny(`${other.map((k) => `--${k.replaceAll("_", "-")}`).join(", ")}: not available to this agent. ${rule.purpose}`);
    const status = a["status"] as string | null;
    if (pyTruthy(status) && !rule.statuses.includes(status!)) return deny(`--status ${status}: not available to this agent. ${rule.purpose}`);
    for (const [target, needs] of Object.entries(rule.statusNeeds ?? {})) {
      if (status === target) {
        const missing = needs.filter((k) => a[k] === null);
        if (missing.length > 0) {
          return deny(
            `--status ${target} goes only with ${missing.map((k) => `--${k.replaceAll("_", "-")}`).join(", ")} for this agent: the verdict is what promotes an application, not the writing. ${rule.purpose}`,
          );
        }
      }
    }
    // `reviewed_by` names the Critic, not the caller, so it stays an argument — but a name,
    // as `send_message` takes one, never free text written into a row other agents read.
    const reviewer = a["reviewed_by"] as string | null;
    if (pyTruthy(reviewer) && !AGENT_NAME.safeParse(reviewer).success) {
      return deny(`--reviewed-by ${pyRepr(reviewer!)}: not an agent name (such as critico-1 or CRITICO-S2).`);
    }
    return updateApplication(options.db(), a, options.agent, options.checkpoint?.(a["position_id"] as number));
  };

  const scoutDedup = (argv: string[]): ScriptResult => {
    const sub = argv[0];
    if (sub === undefined) return argparseError("scout_dedup.py", "the following arguments are required: cmd");
    if (sub !== "check") {
      const error = argparseError("scout_dedup.py", `argument cmd: invalid choice: ${pyRepr(sub)} (choose from 'check')`);
      // T10: a model reaching for db_query's check-url here is told where it is, in the same round.
      if (sub === "check-url") error.stderr += "check-url is a db_query subcommand: db_query check-url <url>\n";
      return error;
    }
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
      `Read the team's database: ${policy.query.join(", ")}.`,
      (argv) =>
        dbQuery(options.db, argv, {
          nonce: options.nonce?.(),
          allowed: policy.query,
          refuse: (sub) => refused("db_query", sub, [...policy.query]),
          ...(options.userId ? { userId: options.userId } : {}),
          policy: options.policy,
        }),
      // `application` answers the SCRITTORE's anti-rewrite gate with its exit code: 1 means
      // the Critic's verdict is already final, which is an answer, as scout_dedup's 10 is.
      [0, 1],
    ),
    tool(
      "db_insert",
      "db_insert.py",
      policy.insert.includes("score")
        ? "Save your score for one position, right after evaluating it: db_insert score --position-id <ID> --total … (scorer.md). Refused when the candidate profile is empty."
        : policy.insert.includes("position")
          ? "Insert a position you found into the team's database, after the duplicate check (skill position-insert)."
          : `Insert into the team's database: ${policy.insert.join(", ")}.`,
      dbInsert,
    ),
    tool(
      "db_update",
      "db_update.py",
      `Update the team's database: ${policy.update.map((e) => `${e} …`).join(", ")}. ${policy.position?.purpose ?? ""}`.trim(),
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

/** The entities of `db_insert.py`, each written here by its own branch. */

/** `shared/skills/score_ranges.py`: the one source of the caps, as the Python validates them. */
const SCORE_TOTAL_LIMIT = 100;
const SCORE_COMPONENT_LIMITS = {
  stack_match: 40,
  remote_fit: 25,
  salary_fit: 20,
  experience_fit: 10,
  strategic_fit: 15,
} as const;

/** `db_insert.py score`'s arguments, flag for flag, maintenance flags included. */
const SCORE_INSERT: CommandSpec = {
  prog: "db_insert.py score",
  options: [
    { flag: "--position-id", type: "int", required: true },
    { flag: "--total", type: "int", required: true },
    { flag: "--stack-match", type: "int" },
    { flag: "--remote-fit", type: "int" },
    { flag: "--salary-fit", type: "int" },
    { flag: "--experience-fit", type: "int" },
    { flag: "--strategic-fit", type: "int" },
    { flag: "--breakdown" },
    { flag: "--pros" },
    { flag: "--cons" },
    { flag: "--notes" },
    { flag: "--scored-by" },
    { flag: "--action", choices: ["liveness_check", "geocode", "logo_fetch", "website_fetch", "jd_refresh", "exclude", "rescore"] },
    { flag: "--outcome", choices: ["confirmed_open", "confirmed_closed", "inconclusive", "updated", "unchanged", "unreachable", "skipped", "failed"] },
    { flag: "--evidence-kind", choices: ["http", "api", "manual", "none"] },
    { flag: "--evidence-url" },
    { flag: "--evidence-code", type: "int" },
    { flag: "--evidence-hash" },
    { flag: "--duration-ms", type: "int" },
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
    { flag: "--salary-declared-min", type: "int" },
    { flag: "--salary-declared-max", type: "int" },
    { flag: "--salary-declared-currency" },
    { flag: "--salary-estimated-min", type: "int" },
    { flag: "--salary-estimated-max", type: "int" },
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
    // `full_remote` too: analista.md says "loc_city unless full_remote", remote_type's word (T21).
    { flag: "--work-mode", choices: ["onsite", "hybrid", "remote", "full_remote"] },
    { flag: "--work-country" },
    { flag: "--work-country-code" },
    { flag: "--is-multi-location", choices: ["true", "false"] },
    { flag: "--location-notes" },
    { flag: "--office-lat", type: "float" },
    { flag: "--office-lon", type: "float" },
    { flag: "--office-address" },
    { flag: "--office-geocoded", choices: ["true", "false"] },
    { flag: "--office-verified", choices: ["true", "false"] },
    { flag: "--action", choices: ["liveness_check", "geocode", "logo_fetch", "website_fetch", "jd_refresh", "exclude", "rescore"] },
    { flag: "--outcome", choices: ["confirmed_open", "confirmed_closed", "inconclusive", "updated", "unchanged", "unreachable", "skipped", "failed"] },
    { flag: "--evidence-kind", choices: ["http", "api", "manual", "none"] },
    { flag: "--evidence-url" },
    { flag: "--evidence-code", type: "int" },
    { flag: "--evidence-hash" },
    { flag: "--duration-ms", type: "int" },
  ],
};

const INSERT_ENTITIES = new Set(["position", "score", "company", "highlight", "application"]);

/** `db_insert.py application` (T25), the flags the SCRITTORE passes. */
const APPLICATION_INSERT: CommandSpec = {
  prog: "db_insert.py application",
  mainProg: "db_insert.py",
  options: [
    { flag: "--position-id", type: "int", required: true },
    { flag: "--cv-path" },
    { flag: "--cl-path" },
    { flag: "--cv-pdf-path" },
    { flag: "--cl-pdf-path" },
    { flag: "--written-by" },
    { flag: "--written-at" },
  ],
};

/** `db_update.py application` (T25). The send and the outcome are not here: nobody in the harness marks a CV sent. */
const APPLICATION_UPDATE: CommandSpec = {
  prog: "db_update.py application",
  mainProg: "db_update.py",
  positionals: [{ name: "position_id", type: "int" }],
  options: [
    { flag: "--status", choices: ["draft", "review", "ready", "approved", "applied", "response"] },
    { flag: "--critic-verdict", choices: ["PASS", "NEEDS_WORK", "REJECT"] },
    { flag: "--critic-score", type: "float" },
    { flag: "--critic-notes" },
    { flag: "--critic-round", type: "int" },
    { flag: "--reviewed-by" },
    { flag: "--written-by" },
    { flag: "--written-at" },
    { flag: "--cv-path" },
    { flag: "--cl-path" },
    { flag: "--cv-pdf-path" },
    { flag: "--cl-pdf-path" },
  ],
};

/** `db_insert.py company`'s arguments. */
const COMPANY_INSERT: CommandSpec = {
  prog: "db_insert.py company",
  options: [
    { flag: "--name", required: true },
    { flag: "--website" },
    { flag: "--hq-country" },
    { flag: "--sector" },
    { flag: "--size" },
    { flag: "--glassdoor-rating", type: "float" },
    { flag: "--red-flags" },
    { flag: "--culture-notes" },
    { flag: "--analyzed-by" },
    { flag: "--verdict", choices: ["GO", "CAUTIOUS", "NO_GO"] },
  ],
};

/** `db_insert.py highlight`'s arguments. */
const HIGHLIGHT_INSERT: CommandSpec = {
  prog: "db_insert.py highlight",
  options: [
    { flag: "--position-id", type: "int", required: true },
    { flag: "--type", required: true, choices: ["pro", "con"] },
    { flag: "--text", required: true },
  ],
};

/** `db_update.py company`'s arguments. */
const COMPANY_UPDATE: CommandSpec = {
  prog: "db_update.py company",
  positionals: [{ name: "name" }],
  options: [
    { flag: "--verdict", choices: ["GO", "CAUTIOUS", "NO_GO"] },
    { flag: "--red-flags" },
    { flag: "--culture-notes" },
    { flag: "--hq-country" },
    { flag: "--sector" },
    { flag: "--size" },
    { flag: "--glassdoor-rating", type: "float" },
    { flag: "--analyzed-by" },
    { flag: "--website" },
    { flag: "--action", choices: MAINTENANCE_ACTIONS },
    { flag: "--outcome", choices: MAINTENANCE_OUTCOMES },
    { flag: "--evidence-kind", choices: EVIDENCE_KINDS },
    { flag: "--evidence-url" },
    { flag: "--evidence-code", type: "int" },
    { flag: "--evidence-hash" },
    { flag: "--duration-ms", type: "int" },
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
export function guarded(run: () => ScriptResult): ScriptResult {
  try {
    return run();
  } catch (error) {
    if (error instanceof ArgvError) return { stdout: "", stderr: `${error.message}\n`, exitCode: 2 };
    return { stdout: "", stderr: `Error: ${(error as Error).message}\n`, exitCode: 1 };
  }
}

export function asExecution(result: ScriptResult, okCodes: number[]): ToolExecution {
  const text = `${result.stdout}${result.stderr ?? ""}`.trimEnd();
  const content = result.exitCode === 0 ? text : `${text}${text ? "\n" : ""}(exit code ${result.exitCode})`;
  return { ok: okCodes.includes(result.exitCode), content, details: { exitCode: result.exitCode } };
}

export type { Parsed };
