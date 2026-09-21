/**
 * T39: `npm run role -- --role closer` on the mock — a rehearsal of a refusal.
 *
 * The CLOSER is the only role that acts outward: it sends the applications
 * the person authorised. Every one of those actions leaves the box — a
 * browser on the recruiter's form, an upload, a Submit, an SMTP send — and
 * none of them exists in this image. What this run pins down is therefore the
 * thing that matters most about porting it: **what it does when sending is
 * not possible**, and what it must not do instead.
 *
 * The run starts from a queue that is READY, as the role's day starts on a
 * real box: the person's consent on, a position they flagged from a user
 * channel, and a CV whose layout poppler measures and passes. A queue that is
 * never ready (as before the layout check was ported) rehearses nothing: the
 * role stops at step 1, and the refusal is never met. On a box without
 * poppler the CV cannot be measured and the queue says so — the rest of the
 * run is then what a model that tries anyway runs into, and asserted alike.
 *
 * The three facts asserted below, in the role's own vocabulary:
 *   CL-02  no receipt, no `applied` — and here the sent state cannot be
 *          written at all: those flags are not ported (db-update.ts), so the
 *          rule is not something to obey, it is an absence;
 *   CL-03  a stop is a stop: the person is told once, the position is left
 *          exactly as it was, and nothing is retried;
 *   CL-04  the queue is the only source of work, and an unreadable queue is
 *          never an empty one.
 */

import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openJobsDb, type Database } from "../src/db/jobs-db.ts";
import { onPath } from "../src/parity/jht-tools.ts";
import { CLI_RUN_TIMEOUT_MS } from "./helpers/cli.ts";
import { passingCv } from "./helpers/pdf-fixtures.ts";
import { RUNTIME } from "./helpers/python-skills.ts";

const run = promisify(execFile);
/** Poppler is detected, as the gate detects it: without it no CV is measured and no queue is ready. */
const poppler = onPath("pdftotext") && onPath("pdffonts");

/** Every row the CLOSER could touch, whole: the send state, the authorisation, the cap, the answers, the questions. */
const snapshot = (db: Database) =>
  Object.fromEntries(
    ["positions", "applications", "apply_cap_reservations", "application_answers", "pending_user_messages"].map((table) => [
      table,
      db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
    ]),
  );

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "jht-closer-run-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("npm run role -- --role closer (T39)", () => {
  it("reaches a READY queue, cannot send, says so once, and leaves every row exactly as it was", async () => {
    // The person's consent, where the gate reads it: their config under the JHT home.
    await mkdir(join(root, "jht"), { recursive: true });
    await writeFile(join(root, "jht", "jht.config.json"), JSON.stringify({ applications: { auto_apply: { enabled: true, mode: "authorised", max_per_day: 5 } } }));
    // The CV the SCRITTORE rendered, in the deliverables (JHT_API_USER_DIR defaults to <api>/user).
    const cv = join(root, "api", "user", "cv", "CV_Acme.pdf");
    await mkdir(join(root, "api", "user", "cv"), { recursive: true });
    await writeFile(cv, passingCv());

    const db = openJobsDb(join(root, "api", "db", "jobs.db"));
    db.prepare(
      "INSERT INTO positions (title, company, url, status, found_by, apply_requested, apply_requested_at, apply_requested_by) " +
        "VALUES ('Backend Engineer', 'Acme', 'https://jobs.example/1', 'ready', 'scout-1', 1, '2026-09-21 09:00:00', 'user_web')",
    ).run();
    db.prepare("INSERT INTO applications (position_id, status, written_by, cv_pdf_path) VALUES (1, 'ready', 'scrittore-1', ?)").run(cv);
    const before = snapshot(db);
    db.close();

    const profileDir = join(root, "person-profile");
    await mkdir(profileDir, { recursive: true });
    await writeFile(join(profileDir, "candidate_profile.yml"), "target_role: Backend Engineer\ntimezone: Europe/Rome\n");
    const imageRoot = join(root, "image-app");
    await cp(join(RUNTIME, "..", "..", "agents"), join(imageRoot, "agents"), { recursive: true });

    const { stdout } = await run(
      process.execPath,
      ["--experimental-strip-types", "src/cli/run.ts", "--role", "closer", "--agent", "closer-1", "--turns", "2", "--pause-ms", "0", "--quiet"],
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
      // The gate answers with exit 1 = "not ready": an answer, not a failure.
      ["apply_gate", "accepted"],
      ["db_query", "accepted"],
      ["db_query", "accepted"],
      // The flow: the one action that would leave the box.
      ["bash", "failed"],
      // And the sent state, which not even a role that wanted to could write.
      ["db_update", "failed"],
      ["notify_user", "accepted"],
      ["send_message", "accepted"],
      ["throttle", "accepted"],
      ["check_user_replies", "accepted"],
    ]);
    const results = finished.map((r) => String(r["result"]));
    // The real gate on a real queue: consent on, the position authorised by the
    // person, the CV measured by poppler and passed — READY, with the position in it.
    if (poppler) {
      expect(results[1]).toContain('"ready": true');
      expect(results[1]).toContain('"reason": "queue_ready"');
      expect(results[1]).toContain(`"positions": [{"position_id": 1, "url": "https://jobs.example/1", "cv_pdf_path": "${cv}"}]`);
    } else {
      // No poppler on this box: the CV is unmeasured, and an unmeasured CV is not a pass.
      expect(results[1]).toContain('"ready": false');
      expect(results[1]).toContain('"reason": "cv_pdf_check_unavailable"');
    }
    // Every index below moved by one: the gate is the first thing the role reads.
    results.splice(1, 1);
    // The refusal teaches, in the role's own words: what is missing, and the
    // rule that follows from it. Words of the refusal, not the script's name —
    // the name is also in any shell's "command not found".
    expect(results[3]).toContain("This image has no browser, so there is no way to send an application from here and no receipt can exist.");
    expect(results[3]).toContain("CL-02 holds: no receipt, no `applied`");
    expect(results[3]).toContain("never write the sent state yourself");
    expect(results[3]).not.toMatch(/command not found|127/);
    expect(results[4]).toMatch(/applied|not available|refused|Error/i);
    expect(records.at(-1)).toMatchObject({ type: "run_finished", reason: "completed" });

    // Nothing moved: not the state, not the authorisation, not a slot of the cap, not a send.
    const after = openJobsDb(join(root, "api", "db", "jobs.db"));
    expect(snapshot(after)).toEqual(before);
    after.close();

    // The person heard about it once, for the whole round.
    const notified = (await readFile(join(root, "api", "channels", "notify.jsonl"), "utf8")).trim().split("\n");
    expect(notified).toHaveLength(1);
    expect(notified[0]).toContain("not sent");
  }, CLI_RUN_TIMEOUT_MS);
});
