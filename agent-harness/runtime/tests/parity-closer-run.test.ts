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

import { openJobsDb } from "../src/db/jobs-db.ts";
import { CLI_RUN_TIMEOUT_MS } from "./helpers/cli.ts";
import { RUNTIME } from "./helpers/python-skills.ts";

const run = promisify(execFile);

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "jht-closer-run-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("npm run role -- --role closer (T39)", () => {
  it("cannot send, says so once, and leaves the position exactly as it was", async () => {
    const db = openJobsDb(join(root, "api", "db", "jobs.db"));
    db.prepare(
      "INSERT INTO positions (title, company, url, status, found_by, apply_requested, apply_requested_by) " +
        "VALUES ('Backend Engineer', 'Acme', 'https://jobs.example/1', 'ready', 'scout-1', 1, 'user_web')",
    ).run();
    db.prepare("INSERT INTO applications (position_id, status, written_by, cv_pdf_path) VALUES (1, 'ready', 'scrittore-1', '/jht_out/cv/CV.pdf')").run();
    const before = {
      position: db.prepare("SELECT status, apply_requested FROM positions WHERE id = 1").get(),
      application: db.prepare("SELECT status, applied, applied_at, applied_via FROM applications WHERE position_id = 1").get(),
    };
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
    // The refusal teaches, in the role's own words: what is missing, and the rule that follows from it.
    expect(results[3]).toContain("no browser");
    expect(results[3]).toContain("no receipt, no `applied`");
    expect(results[3]).not.toMatch(/command not found|127/);
    expect(results[4]).toMatch(/applied|not available|refused|Error/i);
    expect(records.at(-1)).toMatchObject({ type: "run_finished", reason: "completed" });

    // Nothing moved: not the state, not the authorisation, not a send.
    const after = openJobsDb(join(root, "api", "db", "jobs.db"));
    expect(after.prepare("SELECT status, apply_requested FROM positions WHERE id = 1").get()).toEqual(before.position);
    expect(after.prepare("SELECT status, applied, applied_at, applied_via FROM applications WHERE position_id = 1").get()).toEqual(before.application);
    after.close();

    // The person heard about it once, for the whole round.
    const notified = (await readFile(join(root, "api", "channels", "notify.jsonl"), "utf8")).trim().split("\n");
    expect(notified).toHaveLength(1);
    expect(notified[0]).toContain("not sent");
  }, CLI_RUN_TIMEOUT_MS);
});
