/**
 * B1 of banda/piani/JHT-API-TEST.md: for each role, the same input at the
 * level that writes — the script the TUI role runs, the tool the API role
 * gets — and the two databases compared. No model is called.
 *
 * Unlike the older twins (db-tools, db-query), which judge the port against
 * the scripts pinned at schema.sql's commit, B1 runs the scripts of THIS tree:
 * what the TUI team runs today. And it judges the result twice:
 *  - with `scripts/parity/jobsdb_parity.py diff`, the tool that compares the
 *    two teams' live databases, so a difference found here is one the live
 *    comparison would show;
 *  - strictly, every table and column: an agent column by its role, a clock
 *    by its shape (the two sides write their own "now", but must write it the
 *    same way), everything else as written.
 */

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { openJobsDb, type Database } from "../../src/db/jobs-db.ts";
import { createSkillTools } from "../../src/parity/skills/index.ts";
import type { ToolContext, ToolHandler } from "../../src/tools/registry.ts";
import { pythonSkillsOfThisTree, RUNTIME, runPython, type PyRun } from "./python-skills.ts";

const REPO = join(RUNTIME, "..", "..");
export const PYTHON_SKILLS = pythonSkillsOfThisTree();

export interface Twins {
  root: string;
  seed: string;
  tui: string;
  api: string;
}

/** A profile the scorer's gate accepts (the viable one of db-score.test.ts). */
export const PROFILE = "name: Ada Example\ntarget_role: Backend Engineer\nskills: [go, sql]\n";

/** The seed, written once with the runtime's schema, and copied to both sides. */
export function twins(root: string, rows: (db: Database) => void): Twins {
  mkdirSync(root, { recursive: true });
  const t: Twins = { root, seed: join(root, "seed.db"), tui: join(root, "tui.db"), api: join(root, "api.db") };
  const db = openJobsDb(t.seed);
  rows(db);
  db.close();
  copyFileSync(t.seed, t.tui);
  copyFileSync(t.seed, t.api);
  // The same person on both sides: the scorer's gate refuses a score without a profile.
  for (const home of ["tui-home", "api-home"]) {
    mkdirSync(join(root, home, "profile"), { recursive: true });
    writeFileSync(join(root, home, "profile", "candidate_profile.yml"), PROFILE);
  }
  return t;
}

/** The skills a role lists, as the launcher reads `agents/<role>/skills.list`. */
export function skillsOf(role: string): string[] {
  return readFileSync(join(REPO, "agents", role, "skills.list"), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

/** One command of the TUI role: the script of this tree, as the agent runs it. */
export function tui(t: Twins, agent: string, script: string, argv: string[]): PyRun {
  return runPython(PYTHON_SKILLS!, [script, ...argv], { JHT_DB: t.tui, JHT_HOME: join(t.root, "tui-home"), JHT_AGENT_NAME: agent });
}

/** The same command of the API role: the tool it gets from its own skills.list, on the API's database. */
export async function api(t: Twins, agent: string, tool: string, argv: string[]): Promise<{ ok: boolean; content: string }> {
  const role = agent.replace(/-\d+$/, "");
  let db: Database | undefined;
  const open = () => (db ??= openJobsDb(t.api));
  try {
    const tools = createSkillTools({ skills: skillsOf(role), agent, jobsDb: { path: t.api, open }, jhtHome: join(t.root, "api-home"), profileDir: join(t.root, "api-home", "profile"), stateDir: join(t.root, "api-state") });
    const handler = tools.find((h) => h.spec.name === tool) as ToolHandler | undefined;
    if (!handler) return { ok: false, content: `(the ${agent} has no ${tool} tool)` };
    const result = await handler.execute(handler.spec.schema.parse(toolArgs(tool, argv)), {} as ToolContext);
    return { ok: result.ok, content: result.content };
  } finally {
    db?.close();
  }
}

/**
 * The tool's arguments for a command line. Most ports take the script's words
 * as they are (`args`); scout_coord takes them by name, and the same line is
 * spelled out for it: `assign scout-1 --cerchi 1,2 --fonti x` → {command, scout, cerchi, fonti}.
 */
function toolArgs(tool: string, argv: string[]): Record<string, unknown> {
  if (tool !== "scout_coord") return { args: argv };
  const [command, ...rest] = argv;
  const out: Record<string, unknown> = { command };
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i]!;
    if (word.startsWith("--")) {
      const key = word.slice(2).replace(/-/g, "_");
      if (key === "json") out["json"] = true;
      else out[key] = rest[++i];
    } else {
      out[command === "claim" || command === "check-claim" ? "job_id" : "scout"] = word;
    }
  }
  return out;
}

/** `SCOUT-2`, `scout-1`, `scout` → `scout`, as jobsdb_parity.py role_of reads an agent. */
function roleOf(value: unknown): unknown {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase().replace(/-\d+$/, "") : value;
}

const AGENT_COLUMNS = /^(found_by|last_actor|analyzed_by|scored_by|written_by|reviewed_by|by_agent|scout|assigned_agent|agent)$/;
/** A moment with a time of day: compared by its shape, since each side reads its own clock. */
const CLOCK = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/;

function shape(value: string): string {
  return value.replace(/\d/g, "9");
}

/** Every difference between the two databases, table by table, row by row (by id). */
export function strictDiff(t: Twins): string[] {
  const out: string[] = [];
  const tui = openJobsDb(t.tui);
  const api = openJobsDb(t.api);
  try {
    const tables = (db: Database) =>
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
    const tt = tables(tui);
    const at = tables(api);
    for (const name of new Set([...tt, ...at])) {
      if (!tt.includes(name)) out.push(`${name}: only in the API database`);
      if (!at.includes(name)) out.push(`${name}: only in the TUI database`);
      if (!tt.includes(name) || !at.includes(name)) continue;
      const cols = (db: Database) => (db.prepare(`PRAGMA table_info("${name}")`).all() as { name: string }[]).map((c) => c.name);
      const tc = cols(tui);
      const ac = cols(api);
      for (const c of tc) if (!ac.includes(c)) out.push(`${name}.${c}: only in the TUI database`);
      for (const c of ac) if (!tc.includes(c)) out.push(`${name}.${c}: only in the API database`);
      const order = tc.includes("id") ? "ORDER BY id" : "ORDER BY rowid";
      const rows = (db: Database) => db.prepare(`SELECT * FROM "${name}" ${order}`).all() as Record<string, unknown>[];
      const tr = rows(tui);
      const ar = rows(api);
      if (tr.length !== ar.length) out.push(`${name}: ${tr.length} rows in the TUI database, ${ar.length} in the API's`);
      for (let i = 0; i < Math.min(tr.length, ar.length); i++) {
        for (const c of tc.filter((x) => ac.includes(x))) {
          let a = tr[i]![c];
          let b = ar[i]![c];
          if (AGENT_COLUMNS.test(c)) {
            a = roleOf(a);
            b = roleOf(b);
          } else if (typeof a === "string" && typeof b === "string" && CLOCK.test(a) && CLOCK.test(b)) {
            a = shape(a);
            b = shape(b);
          }
          if (JSON.stringify(a) !== JSON.stringify(b)) {
            out.push(`${name}#${String(tr[i]!["id"] ?? i + 1)}.${c}: TUI ${JSON.stringify(a)} · API ${JSON.stringify(b)}`);
          }
        }
      }
    }
  } finally {
    tui.close();
    api.close();
  }
  return out;
}

/** The tables `jobsdb_parity.py diff` does not find in agreement, with what it says of each. */
export function parityDiff(t: Twins): Record<string, unknown> {
  const run = spawnSync("python3", [join(REPO, "scripts", "parity", "jobsdb_parity.py"), "diff", "--tui", t.tui, "--api", t.api, "--seed", t.seed, "--json"], {
    encoding: "utf8",
    env: { PATH: process.env["PATH"] ?? "", PYTHONDONTWRITEBYTECODE: "1" },
  });
  if (run.status !== 0 && !run.stdout.trim().startsWith("{")) throw new Error(`jobsdb_parity diff failed: ${run.stderr}`);
  const report = JSON.parse(run.stdout) as { tables: Record<string, Record<string, unknown> & { agrees: boolean }> };
  const out: Record<string, unknown> = {};
  for (const [table, rep] of Object.entries(report.tables)) {
    if (rep.agrees && (rep["columns_only_tui"] as unknown[]).length === 0 && (rep["columns_only_api"] as unknown[]).length === 0) continue;
    const { by_role: _r, both: _b, seed_changed_both_same: _s, agrees: _a, ...said } = rep;
    out[table] = Object.fromEntries(Object.entries(said).filter(([, v]) => (Array.isArray(v) ? v.length > 0 : v && typeof v === "object" ? Object.keys(v).length > 0 : Boolean(v))));
  }
  return out;
}

/** The seed every B1 scenario starts from: the pipeline at each of its stages. */
export function pipelineSeed(db: Database): void {
  db.prepare("INSERT INTO companies (name) VALUES (?)").run("Acme");
  const add = db.prepare(
    "INSERT INTO positions (title, company, company_id, location, url, status, found_by, jd_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  add.run("Software Engineer, Junior", "Acme", 1, "Milano, IT", "https://acme.example/jobs/1", "new", "scout-1", "Build things.");
  add.run("Data Engineer", "Globex", null, "Berlin", "https://www.linkedin.com/jobs/view/4381470286", "new", "scout-2", "Pipelines.");
  add.run("Backend Engineer", "Initech", null, "Remote, EU", "https://initech.example/jobs/7", "checked", "scout-1", "APIs in Go.");
  add.run("Platform Engineer", "Umbrella", null, "Roma", "https://umbrella.example/jobs/3", "scored", "scout-1", "Kubernetes.");
  db.prepare("INSERT INTO scores (position_id, total_score, scored_by) VALUES (?, ?, ?)").run(4, 78, "scorer-1");
}

/** One command of a scenario: who runs it, the TUI script, the API tool, the same arguments. */
export type Step = [agent: string, script: string, tool: string, argv: string[]];

/** What each step answered on each side: succeeded or not. The scenario's own expectations read it. */
export async function play(t: Twins, steps: Step[]): Promise<Array<{ step: string; tui: boolean; api: boolean; apiSaid: string }>> {
  const out: Array<{ step: string; tui: boolean; api: boolean; apiSaid: string }> = [];
  for (const [agent, script, tool, argv] of steps) {
    const py = tui(t, agent, script, argv);
    const ours = await api(t, agent, tool, argv);
    out.push({ step: `${agent} ${tool} ${argv.slice(0, 3).join(" ")}`, tui: py.status === 0, api: ours.ok, apiSaid: ours.content.split("\n")[0] ?? "" });
  }
  return out;
}
