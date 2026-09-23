/**
 * T41: the DOTTORE's three tools — and, above them, the one refusal that
 * makes the journal worth reading.
 *
 * The role's trade in the TUI is tmux, and seventeen of its functions are gone
 * here by construction (docs/parity.md). What is ported is an archivist: the
 * numbers of a window, the growing journal, the CV reconciliation. So what is
 * held below is not a screenful of parity — it is the three things that decide
 * whether this port tells the truth:
 *
 *   1. the count of what an agent produced is the SCRIPT's count, compared
 *      against `doctor_analytics.py` itself where the box has python3: that
 *      half of the retrospective is the same computation on the same rows;
 *   2. what cannot be measured here says so instead of saying zero. A pane
 *      gave the session's age, the messages and the throttles; a zero in their
 *      place would read as "measured, and none", which is the lie the whole
 *      tool exists to avoid;
 *   3. **an empty window is refused.** The numbers in an entry are measured by
 *      the tool, never taken from the model's arguments, and a window with
 *      nothing in it produces no entry at all — not an entry with zeros, and
 *      not a paragraph. A model asked to summarise silence writes something
 *      plausible; the next Doctor reads the journal as fact.
 *
 * The tools are built through `createSkillTools`, the way the runtime builds
 * them, not called directly: a test that constructs its own tool proves the
 * function and not the wiring (the lesson of cf40bc840 — the credentials fence
 * was held where the roots are really built).
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LEDGER_HEADER } from "../src/core/ledger.ts";
import { openJobsDb, type Database } from "../src/db/jobs-db.ts";
import { createSkillTools } from "../src/parity/skills/index.ts";
import type { ToolHandler } from "../src/tools/registry.ts";
import { pythonSkills, runPython } from "./helpers/python-skills.ts";

const skills = pythonSkills();
/** The DOTTORE's skills, as `agents/dottore/skills.list` names them. */
const DOCTOR_SKILLS = ["tmux-send", "agent-unblock", "db-query", "session-refresh", "liveness-check", "daily-restart-wave", "cache-prune", "py-tools-audit", "cv-disk-audit"];

const WINDOW = "2026-09-23T06:00:00Z";
const NOW = new Date("2026-09-23T12:00:00Z");

let root: string;
let dbPath: string;
let jhtHome: string;
let userDir: string;
let db: Database;

/** The role's tools, built as the runtime builds them. `ledger` only when the run has one. */
function tools(options: { ledger?: string; agent?: string } = {}): Map<string, ToolHandler> {
  const built = createSkillTools({
    skills: DOCTOR_SKILLS,
    agent: options.agent ?? "dottore",
    jobsDb: { path: dbPath, open: () => db },
    jhtHome,
    userDir,
    ...(options.ledger ? { ledger: options.ledger } : {}),
  });
  return new Map(built.map((t) => [t.spec.name, t]));
}

const call = async (tool: ToolHandler, args: unknown) => tool.execute(args, { cwd: root, signal: new AbortController().signal } as never);
const analytics = async (words: string[], options: { ledger?: string } = {}) => {
  const out = await call(tools(options).get("doctor_analytics")!, { args: words });
  return out;
};
const parsed = (content: string) => JSON.parse(content) as Record<string, unknown>;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "jht-dottore-"));
  jhtHome = join(root, "jht");
  userDir = join(root, "api", "user");
  mkdirSync(join(userDir, "cv"), { recursive: true });
  dbPath = join(root, "jobs.db");
  db = openJobsDb(dbPath);
});
afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

/** A position found by `by` at `at`, as the SCOUT's insert writes it. */
function position(by: string, at: string, title = "Backend Engineer"): number {
  db.prepare("INSERT INTO positions (title, company, url, status, found_by, found_at) VALUES (?, 'Acme', ?, 'new', ?, ?)").run(title, `https://jobs.example/${title}-${at}`, by, at);
  return Number((db.prepare("SELECT last_insert_rowid() AS id").get() as { id: number }).id);
}

const journalPath = () => join(jhtHome, "logs", "doctor-retrospective.jsonl");
const journalLines = () => (existsSync(journalPath()) ? readFileSync(journalPath(), "utf8").trim().split("\n") : []);

describe("doctor_analytics (T41)", () => {
  it("counts what the agent produced in the window, and does not count what falls outside it", async () => {
    position("scout-1", "2026-09-23 08:00:00");
    position("scout-1", "2026-09-23 09:00:00", "Platform Engineer");
    // Before the window opened, and another agent's: neither is this window's work.
    position("scout-1", "2026-09-22 08:00:00", "Old Engineer");
    position("scout-2", "2026-09-23 08:30:00", "Other Engineer");
    const out = await analytics(["scout-1", WINDOW]);
    expect(out.ok).toBe(true);
    expect(parsed(out.content)["produced"]).toEqual({ found: 2 });
    expect(parsed(out.content)["signal"]).toBe(true);
  });

  it("matches the author by prefix, as the script does: `scout-1 (codex)` is scout-1", async () => {
    position("scout-1 (codex)", "2026-09-23 08:00:00");
    expect(parsed((await analytics(["scout-1", WINDOW])).content)["produced"]).toEqual({ found: 1 });
  });

  it("says a role produces nothing trackable instead of reporting a zero for it", async () => {
    const out = parsed((await analytics(["capitano", WINDOW])).content);
    expect(out["produced"]).toEqual({});
    expect(out["notes"]).toContain("role 'capitano' does not produce tracked artifacts (singleton/monitoring)");
  });

  /**
   * The count is the script's — on the shape of window the column really
   * holds. Only `produced` is compared: the rest of the script's JSON is read
   * off a tmux session, a message log and a throttle log, none of which exists
   * here, and that difference is the port, not a bug in it.
   */
  it.skipIf(skills === null)("counts exactly what doctor_analytics.py counts on the same rows", async () => {
    position("scout-1", "2026-09-23 08:00:00");
    position("scout-1", "2026-09-23 09:00:00", "Platform Engineer");
    position("scout-1", "2026-09-22 23:59:59", "Old Engineer");
    db.prepare("INSERT INTO applications (position_id, status, written_by, written_at) VALUES (1, 'draft', 'scrittore-1', '2026-09-23 10:00:00')").run();

    // The window as the column holds a timestamp: both sides count the same rows.
    const sameShape = "2026-09-23 06:00:00";
    for (const [session, expected] of [
      ["scout-1", { found: 2 }],
      ["scrittore-1", { written: 1 }],
      ["scorer-1", { scored: 0 }],
    ] as const) {
      const script = runPython(skills!, [join(skills!, "doctor_analytics.py"), session, sameShape, "--db", dbPath, "--messages", join(root, "no-messages.jsonl")]);
      expect(script.status).toBe(0);
      const mine = parsed((await analytics([session, sameShape])).content);
      expect(mine["produced"]).toEqual((JSON.parse(script.stdout) as { produced: unknown }).produced);
      expect(mine["produced"]).toEqual(expected);
    }
  });

  /**
   * The one difference in this count, and it is a defect of the script, held
   * here so nobody ports it back. The Doctor's skill computes the window with
   * `datetime.isoformat()`, and the script puts that string straight into the
   * comparison: `2026-09-23T06:00:00Z` against a column full of
   * `2026-09-23 08:00:00` puts every row before the window, so the script's
   * count is **always zero** — the retrospective's numbers on a real box were
   * measuring nothing. Here the window is converted to the column's own shape.
   */
  it.skipIf(skills === null)("counts the window the script misses: an ISO `T` is not a timestamp of this schema", async () => {
    position("scout-1", "2026-09-23 08:00:00");
    position("scout-1", "2026-09-23 09:00:00", "Platform Engineer");
    const script = runPython(skills!, [join(skills!, "doctor_analytics.py"), "scout-1", WINDOW, "--db", dbPath, "--messages", join(root, "no-messages.jsonl")]);
    expect((JSON.parse(script.stdout) as { produced: { found: number } }).produced).toEqual({ found: 0 });
    expect(parsed((await analytics(["scout-1", WINDOW])).content)["produced"]).toEqual({ found: 2 });
  });

  /**
   * A window with no zone is UTC, as the column is. Asserted by comparing the
   * two spellings of the same instant, which makes the test say the same thing
   * in every zone: with the window read as LOCAL time, a box at -04:00 counted
   * other rows than the script (24/09, `TZ=America/New_York`).
   */
  it("reads a window with no zone as UTC, not as the machine's local time", async () => {
    position("scout-1", "2026-09-23 07:00:00");
    position("scout-1", "2026-09-23 05:00:00", "Early Engineer");
    const zoneless = parsed((await analytics(["scout-1", "2026-09-23 06:00:00"])).content)["produced"];
    const explicit = parsed((await analytics(["scout-1", "2026-09-23T06:00:00Z"])).content)["produced"];
    expect(zoneless).toEqual({ found: 1 });
    expect(zoneless).toEqual(explicit);
  });

  it("says so instead of guessing when the window is not a date at all", async () => {
    position("scout-1", "2026-09-23 08:00:00");
    const out = parsed((await analytics(["scout-1", "last Tuesday"])).content);
    expect(String(out["notes"])).toContain("is not a date");
  });

  it("reports what a pane used to give as not measurable, never as zero", async () => {
    const out = parsed((await analytics(["scout-1", WINDOW])).content);
    expect(out["session_created"]).toBeNull();
    expect(out["session_age_h"]).toBeNull();
    expect(out["communications"]).toBeNull();
    expect(out["throttles"]).toBeNull();
    expect(out["last_captain_msg"]).toBeNull();
    expect(String(out["notes"])).toContain("no session here");
    expect(String(out["notes"])).toContain("the mailbox is drained when the peer reads it");
  });

  it("counts the runs of the window off the ledger, by role and by instance", async () => {
    const ledger = join(root, "ledger.tsv");
    writeFileSync(
      ledger,
      [
        LEDGER_HEADER.join("\t"),
        // In the window: the agent by name, and the same role started without a number.
        `2026-09-23T07:00:00.000Z\tscout-1\tclaude/opus\t100\t0\t20\t0.010000\trun-a\tcompleted`,
        `2026-09-23T08:00:00.000Z\tscout\tclaude/opus\t200\t0\t30\t0.020000\trun-b\tstopped; cache_write_tokens=5`,
        // Another agent, and one outside the window: neither is counted.
        `2026-09-23T09:00:00.000Z\tscorer-1\tclaude/opus\t500\t0\t50\t0.050000\trun-c\tcompleted`,
        `2026-09-22T09:00:00.000Z\tscout-1\tclaude/opus\t900\t0\t90\t0.090000\trun-d\tcompleted`,
        // A line half written by a run still going, and a hand edit: skipped, never thrown on.
        `2026-09-23T10:00:00.000Z\tscout-1\tclaude/opus\t1`,
        "",
      ].join("\n"),
    );
    const runs = parsed((await analytics(["scout-1", WINDOW], { ledger })).content)["runs"];
    expect(runs).toEqual({ count: 2, tokens_in: 300, tokens_out: 50, usd: 0.03, ended: { completed: 1, stopped: 1 } });
  });

  it("says a mock run has no ledger to count, and finds no signal in an empty window", async () => {
    const out = parsed((await analytics(["scorer-1", WINDOW])).content);
    expect(out["runs"]).toEqual({ count: 0, tokens_in: 0, tokens_out: 0, usd: 0, ended: {} });
    expect(String(out["notes"])).toContain("no ledger in this run");
    expect(out["signal"]).toBe(false);
  });

  it("refuses the script's own paths: the database is the runtime's and there is no session to date", async () => {
    for (const flag of [["--db", "/tmp/other.db"], ["--messages", "/tmp/m.jsonl"], ["--throttle", "/tmp/t.jsonl"], ["--session-created", "1758600000"]]) {
      const out = await analytics(["scout-1", WINDOW, ...flag]);
      expect(out.ok).toBe(false);
      expect(out.content).toContain(`${flag[0]} is not taken here`);
    }
  });

  it("answers a missing window the way argparse does, with exit 2", async () => {
    const out = await analytics(["scout-1"]);
    expect(out.ok).toBe(false);
    expect(out.content).toContain("doctor_analytics.py: error:");
  });
});

describe("doctor_journal (T41)", () => {
  it("writes one entry with the MEASURED numbers, and the role's words beside them", async () => {
    position("scout-1", "2026-09-23 08:00:00");
    const out = await call(tools().get("doctor_journal")!, { agent: "scout-1", since: WINDOW, notes: "Two circles searched, one source dry." });
    expect(out.ok).toBe(true);
    const entry = JSON.parse(journalLines()[0]!) as Record<string, unknown>;
    expect(entry["agent"]).toBe("scout-1");
    expect(entry["produced"]).toEqual({ found: 1 });
    expect(entry["notes"]).toBe("Two circles searched, one source dry.");
    expect(entry["by"]).toBe("dottore");
    // A reader of the journal can tell what was measured from what was not.
    expect(entry["source"]).toBe("jobs.db + ledger");
    expect(entry["unmeasured"]).toEqual(["session_age", "communications", "throttles"]);
  });

  it("takes its numbers from the database, not from what the model says in its notes", async () => {
    position("scout-1", "2026-09-23 08:00:00");
    await call(tools().get("doctor_journal")!, { agent: "scout-1", since: WINDOW, notes: "Nine positions found, a record window." });
    const entry = JSON.parse(journalLines()[0]!) as { produced: unknown };
    expect(entry.produced).toEqual({ found: 1 });
  });

  /**
   * The refusal this whole tool is for. Nothing measured → nothing written,
   * and the journal file does not even exist: an entry with zeros would be a
   * record of a round that looked done, which is the same failure as the TUI
   * Doctor logging `round_complete` over a live block.
   */
  it("refuses an empty window and writes nothing at all", async () => {
    const out = await call(tools().get("doctor_journal")!, { agent: "scorer-1", since: WINDOW, notes: "Quiet window, the Scorer was waiting for the queue." });
    expect(out.ok).toBe(false);
    expect(out.content).toContain("Nothing was written to the journal");
    expect(out.content).toContain("a synthesis of it would be invented");
    expect(out.content).toContain("Tell the CAPITANO");
    expect(existsSync(journalPath())).toBe(false);
  });

  it("takes the entry when the window has only runs, and none when the ledger is another agent's", async () => {
    const ledger = join(root, "ledger.tsv");
    writeFileSync(ledger, `${LEDGER_HEADER.join("\t")}\n2026-09-23T07:00:00.000Z\tscorer-1\tclaude/opus\t100\t0\t20\t0.010000\trun-a\tcompleted\n`);
    const mine = await call(tools({ ledger }).get("doctor_journal")!, { agent: "scorer-1", since: WINDOW });
    expect(mine.ok).toBe(true);
    expect((JSON.parse(journalLines()[0]!) as { runs: { count: number } }).runs.count).toBe(1);
    // The same ledger says nothing about the Scout: its window stays empty, and empty is refused.
    const other = await call(tools({ ledger }).get("doctor_journal")!, { agent: "scout-1", since: WINDOW });
    expect(other.ok).toBe(false);
    expect(journalLines()).toHaveLength(1);
  });
});

describe("cv_disk_audit (T41)", () => {
  const cv = (name: string) => join(userDir, "cv", name);

  it("names the orphans and the ghosts, and writes the mismatch to its log", async () => {
    mkdirSync(join(userDir, "cv"), { recursive: true });
    writeFileSync(cv("CV_Acme_1.pdf"), "%PDF-1.4 orphan");
    writeFileSync(cv("CV_Linked_2.pdf"), "%PDF-1.4 linked");
    position("scout-1", "2026-09-23 08:00:00");
    position("scout-1", "2026-09-23 08:10:00", "Platform Engineer");
    db.prepare("INSERT INTO applications (position_id, status, written_by, cv_pdf_path) VALUES (1, 'draft', 'scrittore-1', ?)").run(cv("CV_Linked_2.pdf"));
    db.prepare("INSERT INTO applications (position_id, status, written_by, cv_pdf_path) VALUES (2, 'draft', 'scrittore-1', ?)").run(cv("CV_Gone.pdf"));

    const out = await call(tools().get("cv_disk_audit")!, {});
    expect(out.ok).toBe(true);
    expect(out.content).toContain("orphans=1 ghosts=1");
    expect(out.content).toContain(`orphan: ${cv("CV_Acme_1.pdf")}`);
    expect(out.content).toContain(`ghost: position 2 → ${cv("CV_Gone.pdf")}`);
    const logged = JSON.parse(readFileSync(join(jhtHome, "logs", "cv-disk-audit.jsonl"), "utf8").trim()) as { orphans: string[]; ghosts: Array<{ position_id: number }> };
    expect(logged.orphans).toEqual([cv("CV_Acme_1.pdf")]);
    expect(logged.ghosts).toEqual([{ position_id: 2, cv_pdf_path: cv("CV_Gone.pdf") }]);
  });

  it("writes no log line when disk and database agree", async () => {
    writeFileSync(cv("CV_Linked_1.pdf"), "%PDF-1.4 linked");
    position("scout-1", "2026-09-23 08:00:00");
    db.prepare("INSERT INTO applications (position_id, status, written_by, cv_pdf_path) VALUES (1, 'draft', 'scrittore-1', ?)").run(cv("CV_Linked_1.pdf"));
    const out = await call(tools().get("cv_disk_audit")!, {});
    expect(out.content).toContain("orphans=0 ghosts=0");
    expect(out.content).toContain("nothing to report: disk and database agree");
    expect(existsSync(join(jhtHome, "logs", "cv-disk-audit.jsonl"))).toBe(false);
  });

  /**
   * A row pointing outside the folders this audit reads is not a ghost. The
   * hub's deliverables are a mount of their own, and calling a CV missing
   * because the runtime cannot see the folder would send the CAPITANO after a
   * file that is there.
   */
  it("does not call a row a ghost when its path is outside the folders it reads", async () => {
    position("scout-1", "2026-09-23 08:00:00");
    db.prepare("INSERT INTO applications (position_id, status, written_by, cv_pdf_path) VALUES (1, 'draft', 'scrittore-1', '/elsewhere/cv/CV_Hub.pdf')").run();
    const out = await call(tools().get("cv_disk_audit")!, {});
    expect(out.content).toContain("orphans=0 ghosts=0");
    expect(out.content).toContain("1 row(s) point outside the folders this audit reads");
  });

  it("leaves every row exactly as it was: it reports, it never relinks", async () => {
    writeFileSync(cv("CV_Acme_1.pdf"), "%PDF-1.4 orphan");
    position("scout-1", "2026-09-23 08:00:00");
    db.prepare("INSERT INTO applications (position_id, status, written_by) VALUES (1, 'draft', 'scrittore-1')").run();
    const before = db.prepare("SELECT * FROM applications ORDER BY rowid").all();
    await call(tools().get("cv_disk_audit")!, {});
    expect(db.prepare("SELECT * FROM applications ORDER BY rowid").all()).toEqual(before);
  });
});

describe("the DOTTORE's wiring and its database subset (T41)", () => {
  it("gets the three tools, and the roles that do not list its skills get none of them", () => {
    expect([...tools().keys()]).toEqual(expect.arrayContaining(["doctor_analytics", "doctor_journal", "cv_disk_audit", "db_query"]));
    const scout = createSkillTools({ skills: ["db-query", "db-insert", "position-insert"], agent: "scout-1", jobsDb: { path: dbPath, open: () => db }, jhtHome, userDir });
    expect(scout.map((t) => t.spec.name)).not.toContain("doctor_analytics");
    expect(scout.map((t) => t.spec.name)).not.toContain("doctor_journal");
    expect(scout.map((t) => t.spec.name)).not.toContain("cv_disk_audit");
  });

  it("reads the board and nothing else: a queue of another role is refused, and it writes nowhere", async () => {
    const query = tools().get("db_query")!;
    expect((await call(query, { args: ["dashboard"] })).ok).toBe(true);
    const refused = await call(query, { args: ["next-for-scorer"] });
    expect(refused.ok).toBe(false);
    expect(refused.content).toContain("not available to this agent");
    expect([...tools().keys()]).not.toContain("db_insert");
    expect([...tools().keys()]).not.toContain("db_update");
  });
});

/** The window's `until` is the clock's: asserted once, so a frozen `now` is not needed elsewhere. */
describe("the window's end (T41)", () => {
  it("closes the window at the time of the call", async () => {
    const built = createSkillTools({ skills: DOCTOR_SKILLS, agent: "dottore", jobsDb: { path: dbPath, open: () => db }, jhtHome, userDir });
    const out = await call(built.find((t) => t.spec.name === "doctor_analytics")!, { args: ["scout-1", WINDOW] });
    const until = new Date(String((parsed(out.content)["window"] as { until: string }).until));
    expect(Math.abs(Date.now() - until.getTime())).toBeLessThan(60_000);
    expect(until.getTime()).toBeGreaterThan(NOW.getTime() - 365 * 24 * 3600 * 1000);
  });
});
