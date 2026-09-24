/**
 * T41: `npm run role -- --role dottore` on the mock — an archivist's round.
 *
 * This role is the one where porting for fidelity would have been the mistake:
 * its trade is tmux (dissolve a stuck Enter, read a pane's age, interview a
 * session, kill and recreate it), and the MASTER's decision of 23/09 is that
 * it gets no right to stop or restart anyone here. So the run opens by walking
 * into its own absent half — the step-cap watchdog and the unblock scan — and
 * is told why, in words a model can act on, and then does what is left: the
 * numbers of a window, the journal, the CVs on disk against the rows.
 *
 * What this run pins down is the turn the MASTER asked to see: **what happens
 * when the analytics finds nothing.** One agent's window has work in it and
 * the journal takes the entry; another's is empty, the entry is refused, and
 * the journal file holds exactly one line. The empty window leaves the box as
 * a sentence to the CAPITANO, never as a retrospective — because the next
 * Doctor reads that file as fact.
 */

import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openJobsDb, type Database } from "../src/db/jobs-db.ts";
import { CLI_RUN_TIMEOUT_MS } from "./helpers/cli.ts";
import { RUNTIME } from "./helpers/python-skills.ts";

const run = promisify(execFile);

/** Every row the round could touch: the archivist writes in none of them. */
const snapshot = (db: Database) =>
  Object.fromEntries(["positions", "applications", "scores"].map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "jht-dottore-run-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("npm run role -- --role dottore (T41)", () => {
  it("records the window it can measure, refuses the empty one, and reconciles the CVs", async () => {
    // The deliverables: one CV on disk no row points at (bug #26's orphan).
    const cvDir = join(root, "api", "user", "cv");
    await mkdir(cvDir, { recursive: true });
    await writeFile(join(cvDir, "CV_Acme_1.pdf"), "%PDF-1.4 orphan");

    // The window's work: a position the SCOUT found. The SCORER has nothing —
    // that is the empty window the round runs into.
    const db = openJobsDb(join(root, "api", "db", "jobs.db"));
    db.prepare(
      "INSERT INTO positions (title, company, url, status, found_by, found_at) VALUES ('Backend Engineer', 'Acme', 'https://jobs.example/1', 'new', 'scout-1', '2026-09-23 08:00:00')",
    ).run();
    const before = snapshot(db);
    db.close();

    const profileDir = join(root, "person-profile");
    await mkdir(profileDir, { recursive: true });
    await writeFile(join(profileDir, "candidate_profile.yml"), "target_role: Backend Engineer\ntimezone: Europe/Rome\n");
    const imageRoot = join(root, "image-app");
    await cp(join(RUNTIME, "..", "..", "agents"), join(imageRoot, "agents"), { recursive: true });

    const { stdout } = await run(
      process.execPath,
      ["--experimental-strip-types", "src/cli/run.ts", "--role", "dottore", "--agent", "dottore", "--turns", "1", "--pause-ms", "0", "--quiet"],
      {
        cwd: RUNTIME,
        env: {
          PATH: process.env["PATH"] ?? "",
          HOME: root,
          JHT_API_HOME: join(root, "api"),
          JHT_HOME: join(root, "jht"),
          JHT_API_PROFILE_DIR: profileDir,
          JHT_API_APP_ROOT: imageRoot,
          JHT_API_PROVIDER: "mock",
        },
      },
    );
    const records = (await readFile(stdout.trim(), "utf8"))
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { type: string; [k: string]: unknown });
    const finished = records.filter((r) => r.type === "tool_finished");
    expect(finished.map((r) => [r["name"], r["outcome"]])).toEqual([
      ["read_file", "accepted"],
      // The half of the trade that does not exist here: both refused, with the reason.
      ["bash", "failed"],
      ["bash", "failed"],
      ["db_query", "accepted"],
      // The window that has work in it, and the entry it earns.
      ["doctor_analytics", "accepted"],
      ["doctor_journal", "accepted"],
      // The window that has nothing, and the entry it does NOT earn.
      ["doctor_analytics", "accepted"],
      ["doctor_journal", "failed"],
      ["send_message", "accepted"],
      ["cv_disk_audit", "accepted"],
      ["send_message", "accepted"],
    ]);
    const results = finished.map((r) => String(r["result"]));

    // The refusals teach what is missing, and never read as a bug to route around.
    expect(results[1]).toContain("A run that reaches its ceiling here ends and says so");
    expect(results[2]).toContain("a message is a file the peer drains at its next turn, and there is no composer to type into");
    expect(results[2]).toContain("starting and stopping roles is the hub's, and not yours");
    for (const refusal of [results[1]!, results[2]!]) expect(refusal).not.toMatch(/command not found|127/);

    // The measurable window: the count is real, and what a pane used to give says so.
    expect(results[4]).toContain('"produced":{"found":1}');
    expect(results[4]).toContain('"signal":true');
    expect(results[4]).toContain('"communications":null');
    expect(results[4]).toContain("no session here");
    expect(results[5]).toContain("Appended to");

    // The empty one: nothing measured, nothing written, and the refusal says what to do.
    expect(results[6]).toContain('"produced":{"scored":0}');
    expect(results[6]).toContain('"signal":false');
    expect(results[7]).toContain("Nothing was written to the journal");
    expect(results[7]).toContain("a synthesis of it would be invented");

    // The journal holds ONE line: the window that was measured. Not a second with zeros.
    const journal = (await readFile(join(root, "jht", "logs", "doctor-retrospective.jsonl"), "utf8")).trim().split("\n");
    expect(journal).toHaveLength(1);
    const entry = JSON.parse(journal[0]!) as { agent: string; produced: unknown; runs: { count: number } };
    expect(entry.agent).toBe("scout-1");
    expect(entry.produced).toEqual({ found: 1 });
    // A mock run spends nothing, so it appends nothing to the ledger: no runs to count,
    // and the entry says so rather than implying the Scout never ran.
    expect(entry.runs.count).toBe(0);
    expect(journal[0]).not.toContain("scorer-1");

    // The CVs: the orphan is named, and the audit log carries it.
    expect(results[9]).toContain("orphans=1 ghosts=0");
    expect(results[9]).toContain(join(cvDir, "CV_Acme_1.pdf"));
    const audit = JSON.parse((await readFile(join(root, "jht", "logs", "cv-disk-audit.jsonl"), "utf8")).trim()) as { orphans: string[] };
    expect(audit.orphans).toEqual([join(cvDir, "CV_Acme_1.pdf")]);

    expect(records.at(-1)).toMatchObject({ type: "run_finished", reason: "completed" });

    // The archivist changed nothing in the team's database.
    const after = openJobsDb(join(root, "api", "db", "jobs.db"));
    expect(snapshot(after)).toEqual(before);
    after.close();
  }, CLI_RUN_TIMEOUT_MS);
});
