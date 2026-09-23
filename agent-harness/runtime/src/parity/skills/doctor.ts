/**
 * The DOTTORE's tools (T41): what is left of it here, and nothing more.
 *
 * In the TUI the Doctor's whole trade is tmux: it dissolves an Enter stuck in
 * a composer, reads a pane's age, interviews a session and kills+recreates it
 * so a bloated context window starts clean. The harness has no panes and no
 * sessions, and every run begins with a clean context — so seventeen of its
 * functions are not ported for fidelity, they are gone by construction, and
 * `docs/parity.md` says which and why. The MASTER's decision (23/09): the
 * DOTTORE does **not** get the right to stop or restart another role. That
 * right exists in the TUI because a context bloats and an Invio hangs; here
 * neither happens, and the most dangerous permission we have is not handed
 * out against a case nobody has seen. If a stuck run ever shows up it is
 * added then, from the hub, with the rule the team already has: the role
 * asks, the launcher decides.
 *
 * What remains is an archivist, and that is what these three tools are:
 *
 * - `doctor_analytics` — the objective half of the old retrospective, from
 *   the sources this runtime really has: the artifacts in `jobs.db` and the
 *   spend ledger. Never the trace: the trace holds what an agent *said* —
 *   prompts, replies, tool arguments — and an archivist that reads its
 *   colleagues' words is not an archivist. The audit trail would be
 *   sanitised, but carries no role, so nothing in it can be attributed;
 * - `doctor_journal` — the growing journal, whose entry is the *measured*
 *   numbers plus the role's own words. It refuses to write when the analytics
 *   found nothing: a retrospective of a window with nothing in it would be
 *   invented, and a journal the next Doctor reads as fact must not contain a
 *   sentence a model composed out of an empty measurement;
 * - `cv_disk_audit` — the disk↔DB reconciliation of the CVs (orphans and
 *   ghosts, bug #26), deterministic and read-only, with the mismatch written
 *   to its own log. It deletes nothing and relinks nothing: that was the
 *   CAPITANO's in the skill, and it stays the CAPITANO's here.
 */

import { readFileSync } from "node:fs";
import { appendFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { z } from "zod";

import { ArgvError, parseArgv, type CommandSpec } from "../../db/argv.ts";
import type { Database } from "../../db/jobs-db.ts";
import { roleOf } from "../../db/role-policy.ts";
import type { ScriptResult } from "../../db/tools.ts";
import type { ToolHandler } from "../../tools/registry.ts";
import { LEDGER_HEADER } from "../../core/ledger.ts";
import { ledgerAgentName } from "../sentinel-tick.ts";
import { argvTool } from "./argv-tool.ts";

export interface DoctorToolsOptions {
  /** The team's database, opened by the runtime. */
  db: () => Database;
  /** The agent the tools act for: `dottore`. */
  agent: string;
  /** `$JHT_HOME`: the journal and the audit log go under its `logs/`, as the skills write them. */
  jhtHome: string;
  /** The team's spend ledger (`JHT_API_LEDGER`), when the run has one: a mock run has none. */
  ledger?: string | undefined;
  /** The folders a CV may live in: the deliverables' `cv/` and the hub's own. */
  cvRoots: readonly string[];
  now?: () => Date;
}

/**
 * Role → where its work lands, as `doctor_analytics.py` counts it: the table,
 * the author column, the timestamp that puts a row inside the window, and the
 * word the count is reported under. The `*_by` columns are the same ones the
 * product writes (`shared/skills/_db.py`).
 */
const PRODUCTION: Readonly<Record<string, { table: string; by: string; ts: string; label: string }>> = {
  scout: { table: "positions", by: "found_by", ts: "found_at", label: "found" },
  analista: { table: "positions", by: "analyzed_by", ts: "last_checked", label: "analyzed" },
  scorer: { table: "scores", by: "scored_by", ts: "scored_at", label: "scored" },
  scrittore: { table: "applications", by: "written_by", ts: "written_at", label: "written" },
  critico: { table: "applications", by: "reviewed_by", ts: "critic_reviewed_at", label: "reviewed" },
};

/** One agent's window, as the analytics measured it. */
interface Analytics {
  session: string;
  role: string;
  instance: number | null;
  /** Always null: there is no session here, so there is no age to report. */
  session_created: null;
  session_age_h: null;
  window: { since: string; until: string };
  produced: Record<string, number>;
  runs: { count: number; tokens_in: number; tokens_out: number; usd: number; ended: Record<string, number> };
  /** Always null: the mailbox is drained when read, so messages are not a log. */
  communications: null;
  throttles: null;
  last_captain_msg: null;
  /** Whether anything was measured at all. What the journal refuses on. */
  signal: boolean;
  notes: string[];
}

const ANALYTICS: CommandSpec = {
  prog: "doctor_analytics.py",
  positionals: [{ name: "session" }, { name: "since_iso" }],
  options: [{ flag: "--db", default: null }, { flag: "--messages", default: null }, { flag: "--throttle", default: null }, { flag: "--session-created", default: null }],
};

/** `SCOUT-1` → `('scout', 1)`, as the script parses a session name. */
function parseSession(session: string): { role: string; instance: number | null } {
  const name = session.trim().toLowerCase();
  const match = /^(.*)-(\d+)$/.exec(name);
  return match ? { role: match[1]!, instance: Number(match[2]) } : { role: name, instance: null };
}

/**
 * The window's start in the shape the timestamp columns really hold —
 * `YYYY-MM-DD HH:MM:SS`, UTC, which is what SQLite's `CURRENT_TIMESTAMP`
 * writes and what every `*_at` column of this schema is full of.
 *
 * **A difference from the script, on purpose, and a defect it has.**
 * `doctor_analytics.py` interpolates the ISO string it is given straight into
 * the comparison, and the Doctor's own skill computes that string with
 * `datetime.isoformat()` — `2026-09-23T06:00:00+00:00`. Compared as text
 * against `2026-09-23 08:00:00`, the `T` loses to the space at the eleventh
 * character, so **every row falls before the window and the count is always
 * zero** (measured on the real script, 23/09). A window that silently matches
 * nothing is precisely the empty measurement this port must never produce — it
 * is what the journal refuses to write about — so the string is converted to
 * the column's own shape before it reaches the SQL, and a value that is not a
 * date at all is passed through with a note instead of being invented.
 */
function sqlTimestamp(sinceIso: string, notes: string[]): string {
  const at = new Date(sinceIso);
  if (Number.isNaN(at.getTime())) {
    notes.push(`since '${sinceIso}' is not a date: the window is compared as the text it is, which may match nothing`);
    return sinceIso;
  }
  return at.toISOString().replace("T", " ").slice(0, 19);
}

/** The columns of `table`, empty when there is no such table. The script's defensive read. */
function columnsOf(db: Database, table: string): Set<string> {
  try {
    return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((r) => r.name));
  } catch {
    return new Set();
  }
}

/**
 * What the agent produced in the window. The author match is a prefix, as the
 * script's is: the `*_by` columns hold `scout-1` on this runtime and
 * `scout-1 (codex)` on a TUI box, and the same database may have both.
 */
function countProduced(db: Database, role: string, session: string, since: string, notes: string[]): Record<string, number> {
  const spec = PRODUCTION[role];
  if (!spec) {
    notes.push(`role '${role}' does not produce tracked artifacts (singleton/monitoring)`);
    return {};
  }
  const cols = columnsOf(db, spec.table);
  if (cols.size === 0) {
    notes.push(`missing table ${spec.table}`);
    return { [spec.label]: 0 };
  }
  if (!cols.has(spec.by)) {
    notes.push(`missing column ${spec.table}.${spec.by}`);
    return { [spec.label]: 0 };
  }
  const where = [`${spec.by} LIKE ?`];
  const params: string[] = [`${session.toLowerCase()}%`];
  if (cols.has(spec.ts)) {
    where.push(`${spec.ts} >= ?`);
    params.push(sqlTimestamp(since, notes));
  } else {
    notes.push(`missing timestamp column ${spec.table}.${spec.ts} → count is not filtered by window`);
  }
  try {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${spec.table} WHERE ${where.join(" AND ")}`).get(...params) as { n: number };
    return { [spec.label]: Number(row.n) };
  } catch (error) {
    notes.push(`produced query failed: ${(error as Error).message}`);
    return { [spec.label]: 0 };
  }
}

/**
 * The agent's runs in the window, off the ledger: how many, what they cost,
 * and how each one ended (the ledger's `note`, which is `completed`, `stopped`
 * or a failure code).
 *
 * Defensive like the SENTINELLA's reader, and for the same reason: the file is
 * a TSV live runs append to while they are still going, so a half-written
 * line, a header or a hand edit must not throw — a row that cannot be parsed
 * is a row that is not counted. A **mock** run writes nothing here at all,
 * which is not a failure: it is the honest reason why the analytics of a mock
 * window finds nothing.
 */
function readRuns(path: string, session: string, from: Date, to: Date, notes: string[]): Analytics["runs"] {
  const runs: Analytics["runs"] = { count: 0, tokens_in: 0, tokens_out: 0, usd: 0, ended: {} };
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    notes.push(`the ledger is not readable (${path}) → runs and spend are unknown`);
    return runs;
  }
  const wanted = session.toLowerCase();
  const role = roleOf(wanted);
  for (const line of text.split("\n")) {
    if (line.trim() === "" || line.startsWith(LEDGER_HEADER[0]!)) continue;
    const fields = line.split("\t");
    if (fields.length < 7) continue;
    const at = new Date(fields[0]!);
    const usd = Number(fields[6]);
    if (Number.isNaN(at.getTime()) || !Number.isFinite(usd)) continue;
    if (at < from || at > to) continue;
    // The same closed list of names the tick uses: a `ruolo` nobody recognises
    // is `altro` there and matches no agent here.
    const agent = ledgerAgentName(fields[1]!);
    // `--role scout` writes `scout`, `--agent scout-2` writes `scout-2`: an
    // agent asked about by name owns both, and a role asked about owns all of
    // its instances. Neither is a guess — it is how the ledger's column is written.
    if (agent !== wanted && agent !== role && roleOf(agent) !== wanted) continue;
    runs.count += 1;
    runs.tokens_in += Number(fields[3]) || 0;
    runs.tokens_out += Number(fields[5]) || 0;
    runs.usd += usd;
    const ended = (fields[8] ?? "").split(";")[0]!.trim() || "unrecorded";
    runs.ended[ended] = (runs.ended[ended] ?? 0) + 1;
  }
  runs.usd = Number(runs.usd.toFixed(6));
  return runs;
}

const ISO_Z = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, "Z");

/** The window's numbers for one agent, from the database and the ledger. */
export function collectAnalytics(options: DoctorToolsOptions, session: string, sinceIso: string): Analytics {
  const now = (options.now ?? (() => new Date()))();
  const notes: string[] = [];
  const { role, instance } = parseSession(session);
  const since = new Date(sinceIso);
  if (Number.isNaN(since.getTime())) notes.push(`since '${sinceIso}' is not a date the window can start at → the runs are not filtered by it`);
  // The three things a pane gave and nothing here does. Said once, as data:
  // a zero would read as "measured and none", which is the lie this whole
  // tool exists to avoid.
  notes.push("no session here: an agent is a run, not a pane, so there is no session age and no context occupancy to read");
  notes.push("communications are not measurable: the mailbox is drained when the peer reads it, so it is a queue, never a log");
  notes.push("throttles are not measurable: a pause is the harness's own and leaves no per-agent log");

  let produced: Record<string, number> = {};
  try {
    // The handle is the runtime's, shared by every tool of the run and closed
    // by it: a tool that closed it would take the database away from the next
    // call (the DB tools do not close it either).
    produced = countProduced(options.db(), role, session, sinceIso, notes);
  } catch (error) {
    notes.push(`failed to open the database: ${(error as Error).message}`);
  }
  const runs = options.ledger
    ? readRuns(options.ledger, session, Number.isNaN(since.getTime()) ? new Date(0) : since, now, notes)
    : ((): Analytics["runs"] => {
        notes.push("no ledger in this run: a mock run records no spend, so its runs cannot be counted");
        return { count: 0, tokens_in: 0, tokens_out: 0, usd: 0, ended: {} };
      })();

  const produce = Object.values(produced).some((n) => n > 0);
  return {
    session,
    role,
    instance,
    session_created: null,
    session_age_h: null,
    window: { since: sinceIso, until: ISO_Z(now) },
    produced,
    runs,
    communications: null,
    throttles: null,
    last_captain_msg: null,
    signal: produce || runs.count > 0,
    notes,
  };
}

/** `doctor_analytics.py <SESSION> <since_iso>`: the objective half of the retrospective. */
function analyticsTool(options: DoctorToolsOptions): ToolHandler {
  return argvTool({
    name: "doctor_analytics",
    script: "doctor_analytics.py",
    description:
      "The objective numbers of one agent's window: what it produced in the team's database and what its runs " +
      "cost, off the spend ledger. Read-only. `signal: false` means nothing was measured — then there is nothing " +
      "to write a retrospective about, and `doctor_journal` will say so.",
    run: (words): ScriptResult => {
      let parsed;
      try {
        parsed = parseArgv(ANALYTICS, words);
      } catch (error) {
        if (error instanceof ArgvError) return { stdout: "", stderr: `${error.message}\n`, exitCode: error.exitCode };
        throw error;
      }
      // The script's own paths are the box's, not the model's: the database is
      // the runtime's and the messages and throttle logs do not exist here.
      for (const flag of ["db", "messages", "throttle", "session_created"]) {
        if (parsed[flag] !== null) {
          // The script's paths are the box's, not the model's: the database is the
          // runtime's, and there is neither a message log nor a session to date.
          return {
            stdout: "",
            stderr:
              `doctor_analytics.py: error: --${flag.replaceAll("_", "-")} is not taken here. The database is the ` +
              `runtime's own, and there is no message log and no session to date: the answer's notes say what is not measurable.\n`,
            exitCode: 2,
          };
        }
      }
      const out = collectAnalytics(options, String(parsed["session"]), String(parsed["since_iso"]));
      return { stdout: `${JSON.stringify(out)}\n`, stderr: "", exitCode: 0 };
    },
  });
}

const JOURNAL_ARGS = z
  .object({
    agent: z.string().min(1).max(64).describe("the agent the entry is about: scout-1"),
    since: z.string().min(1).max(64).describe("ISO-UTC start of the window the entry covers"),
    notes: z.string().max(4_000).optional().describe("your own dense synthesis, in your words: what it did, what it learned, what got in its way"),
  })
  .strict();

/**
 * The growing journal — and the one refusal that makes it worth reading.
 *
 * The entry's numbers are measured here, not passed in: the tool runs the
 * analytics itself, so a line in the journal cannot say three CVs where the
 * database holds none. The model's own words ride along in `notes`, beside
 * the numbers and never instead of them.
 *
 * When the analytics finds nothing — no artifact in the window, no run in the
 * ledger — nothing is written and the refusal says why. This is the whole
 * point of the tool: the TUI Doctor built its synthesis out of an interview,
 * and an interview always answers something; a model asked to summarise an
 * empty window will write a plausible paragraph, and the next Doctor reads
 * the journal as fact. An empty window is information — it goes to the
 * CAPITANO as a sentence, not into the record as a retrospective.
 */
function journalTool(options: DoctorToolsOptions): ToolHandler {
  const path = join(options.jhtHome, "logs", "doctor-retrospective.jsonl");
  return {
    spec: {
      name: "doctor_journal",
      description:
        "Append one dense entry about an agent's window to the team's growing retrospective journal. The numbers are " +
        "measured by the tool itself (the same ones `doctor_analytics` reports); your `notes` are your words beside them. " +
        "A window with nothing measured is refused and nothing is written: report it instead of summarising it.",
      schema: JOURNAL_ARGS,
    },
    classify: (args) => {
      const a = args as z.infer<typeof JOURNAL_ARGS>;
      return { risk: "write", paths: [path], summary: `${a.agent} since ${a.since}` };
    },
    execute: (args) => {
      const a = args as z.infer<typeof JOURNAL_ARGS>;
      const analytics = collectAnalytics(options, a.agent, a.since);
      if (!analytics.signal) {
        return Promise.resolve({
          ok: false,
          content:
            `Nothing was written to the journal. The window of ${a.agent} since ${a.since} has no artifact in the ` +
            `database and no run in the ledger: there is nothing measured to write a retrospective about, and a ` +
            `synthesis of it would be invented. Tell the CAPITANO that the window is empty — that is the finding.`,
        });
      }
      const entry = {
        ts: ISO_Z((options.now ?? (() => new Date()))()),
        by: options.agent,
        agent: a.agent,
        role: analytics.role,
        window: analytics.window,
        produced: analytics.produced,
        runs: analytics.runs,
        ...(a.notes ? { notes: a.notes } : {}),
        // Where the numbers come from, so a reader of the journal can tell a
        // measurement from a story — and see what was NOT measured.
        source: "jobs.db + ledger",
        unmeasured: ["session_age", "communications", "throttles"],
      };
      const line = JSON.stringify(entry);
      try {
        mkdirSync(join(options.jhtHome, "logs"), { recursive: true });
        appendFileSync(path, `${line}\n`, "utf8");
      } catch (error) {
        return Promise.resolve({ ok: false, content: `Error: the journal at ${path} could not be appended to: ${(error as Error).message}. Nothing was written.` });
      }
      return Promise.resolve({ ok: true, content: `Appended to ${path}:\n${line}` });
    },
  };
}

/** A CV on disk, or one a row points at: the paths the audit compares. */
function pdfsOnDisk(roots: readonly string[], notes: string[]): string[] {
  const found = new Set<string>();
  for (const root of roots) {
    let names: string[];
    try {
      names = readdirSync(root);
    } catch {
      notes.push(`${root} is not readable: no CV counted there`);
      continue;
    }
    for (const name of names) {
      if (!name.toLowerCase().endsWith(".pdf")) continue;
      const path = join(root, name);
      try {
        // A folder named `x.pdf` is not a CV, and a dangling link is not a file.
        if (statSync(path).isFile()) found.add(resolve(path));
      } catch {
        // Gone between the listing and the stat: not on disk, so not counted.
      }
    }
  }
  return [...found].sort();
}

/**
 * `cv-disk-audit`: the CVs on disk against `applications.cv_pdf_path`.
 *
 * Bug #26's shape: the SCRITTORE renders the PDF and is killed before the
 * UPDATE, so the file exists and the column is NULL — the person sees "CV to
 * write" for a CV that is written, and the best position of the window is
 * invisible. The two names are the skill's: an **orphan** is a file no row
 * points at, a **ghost** is a row pointing at a file that is not there.
 *
 * Deterministic and read-only, as the skill's own procedure is ("niente
 * LLM"): it deletes nothing, relinks nothing and writes one line to its log
 * only when there is a mismatch. What to do about a mismatch is the
 * CAPITANO's call, and the report goes to it with `send_message`.
 */
function cvAuditTool(options: DoctorToolsOptions): ToolHandler {
  const log = join(options.jhtHome, "logs", "cv-disk-audit.jsonl");
  return {
    spec: {
      name: "cv_disk_audit",
      description:
        "Reconcile the CVs on disk with `applications.cv_pdf_path`: orphans (a PDF no row points at) and ghosts " +
        "(a row pointing at a PDF that is not there). Read-only — it deletes nothing and relinks nothing; a mismatch " +
        "is reported to the CAPITANO, which decides. The mismatch is also written to the audit log.",
      schema: z.object({}).strict(),
    },
    classify: () => ({ risk: "read", paths: [...options.cvRoots], summary: "" }),
    execute: () => {
      const notes: string[] = [];
      const disk = pdfsOnDisk(options.cvRoots, notes);
      let rows: Array<{ position_id: number; cv_pdf_path: string }>;
      try {
        rows = options
          .db()
          .prepare("SELECT position_id, cv_pdf_path FROM applications WHERE cv_pdf_path IS NOT NULL AND TRIM(cv_pdf_path) <> '' ORDER BY position_id")
          .all() as Array<{ position_id: number; cv_pdf_path: string }>;
      } catch (error) {
        return Promise.resolve({ ok: false, content: `Error: the team's database could not be read: ${(error as Error).message}. Nothing was audited.` });
      }
      const inDb = new Map(rows.map((r) => [resolve(r.cv_pdf_path), r.position_id]));
      // A row whose path is outside the folders this audit can see is not a
      // ghost: it is a row about a file the runtime was never allowed to look
      // for. Counting it as missing would send the CAPITANO after a CV that is
      // there (the hub's deliverables are a mount of their own).
      const visible = (path: string) => options.cvRoots.some((root) => path.startsWith(`${resolve(root)}/`));
      const orphans = disk.filter((path) => !inDb.has(path));
      const ghosts = rows.filter((r) => !disk.includes(resolve(r.cv_pdf_path)) && visible(resolve(r.cv_pdf_path)));
      const unseen = rows.length - ghosts.length - rows.filter((r) => disk.includes(resolve(r.cv_pdf_path))).length;
      if (unseen > 0) notes.push(`${unseen} row(s) point outside the folders this audit reads: not counted as ghosts`);
      if (orphans.length + ghosts.length > 0) {
        const entry = { ts: ISO_Z((options.now ?? (() => new Date()))()), by: options.agent, orphans, ghosts: ghosts.map((g) => ({ position_id: g.position_id, cv_pdf_path: g.cv_pdf_path })) };
        try {
          mkdirSync(join(options.jhtHome, "logs"), { recursive: true });
          appendFileSync(log, `${JSON.stringify(entry)}\n`, "utf8");
        } catch (error) {
          notes.push(`the audit log at ${log} could not be written: ${(error as Error).message}`);
        }
      }
      const lines = [
        `CV audit — orphans=${orphans.length} ghosts=${ghosts.length} (on disk: ${disk.length}, rows with a CV: ${rows.length})`,
        ...orphans.map((path) => `orphan: ${path}`),
        ...ghosts.map((g) => `ghost: position ${g.position_id} → ${g.cv_pdf_path}`),
        ...(orphans.length + ghosts.length > 0 ? [`written to ${log}`] : ["nothing to report: disk and database agree"]),
        ...notes.map((note) => `note: ${note}`),
      ];
      return Promise.resolve({ ok: true, content: lines.join("\n") });
    },
  };
}

/** The DOTTORE's three tools. The database is needed by all of them. */
export function createDoctorTools(options: DoctorToolsOptions): ToolHandler[] {
  return [analyticsTool(options), journalTool(options), cvAuditTool(options)];
}
