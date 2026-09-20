/**
 * T25: `npm run role -- --role scrittore` on the mock, as a person types it.
 * The SCRITTORE takes the position the person asked a CV for, opens the
 * anti-rewrite gate, claims it, reads the profile, writes the CV where the
 * person will find it, records the application and hands it to the Critic.
 * No PDF: the image carries no pandoc, and the prompt it runs on says so.
 */

import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openJobsDb } from "../src/db/jobs-db.ts";
import { RUNTIME } from "./helpers/python-skills.ts";

const run = promisify(execFile);

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "jht-scrittore-run-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("npm run role -- --role scrittore (T25)", () => {
  it("writes the CV into the deliverables, records the application and asks the Critic", async () => {
    const db = openJobsDb(join(root, "api", "db", "jobs.db"));
    db.prepare(
      "INSERT INTO positions (title, company, url, status, found_by, found_at, jd_text, write_requested, write_requested_at) " +
        "VALUES ('Backend Engineer', 'Acme', 'https://acme.example/jobs/1', 'scored', 'scout-1', '2026-09-18 09:00:00', 'TypeScript services.', 1, '2026-09-19 18:00:00')",
    ).run();
    db.prepare("INSERT INTO scores (position_id, total_score) VALUES (1, 78)").run();
    db.close();
    const profileDir = join(root, "person-profile");
    await mkdir(profileDir, { recursive: true });
    await writeFile(join(profileDir, "candidate_profile.yml"), "target_role: Backend Engineer\nyears: 6\n");
    const imageRoot = join(root, "image-app");
    await cp(join(RUNTIME, "..", "..", "agents"), join(imageRoot, "agents"), { recursive: true });

    const { stdout } = await run(
      process.execPath,
      ["--experimental-strip-types", "src/cli/run.ts", "--role", "scrittore", "--agent", "scrittore-1", "--turns", "2", "--pause-ms", "0", "--quiet"],
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
      ["db_query", "accepted"],
      ["db_update", "accepted"],
      ["read_file", "accepted"],
      ["write_file", "accepted"],
      ["db_insert", "accepted"],
      ["db_update", "accepted"],
      ["send_message", "accepted"],
      ["throttle", "accepted"],
      ["check_user_replies", "accepted"],
    ]);
    const results = finished.map((r) => String(r["result"]));
    expect(results[1]).toMatch(/Positions with a user-requested CV, CV rework or cover letter \(1\)/);
    expect(results[3]).toBe("No application for position 1. PROCEED.");
    expect(results[4]).toBe("Position 1 updated: status=writing");
    expect(results[7]).toBe("Application inserted for position 1");
    expect(records.at(-1)).toMatchObject({ type: "run_finished", reason: "completed" });

    // The deliverable is where the person will look for it, and the row points at it.
    const cvDir = join(root, "api", "user", "cv");
    expect(await readdir(cvDir)).toEqual(["CV_Candidate_1_acme.md"]);
    expect(await readFile(join(cvDir, "CV_Candidate_1_acme.md"), "utf8")).toContain("# Candidate — Backend Engineer");
    const after = openJobsDb(join(root, "api", "db", "jobs.db"));
    expect(after.prepare("SELECT status FROM positions WHERE id = 1").get()).toEqual({ status: "writing" });
    expect(after.prepare("SELECT position_id, cv_path, cv_pdf_path, status, written_by, critic_verdict FROM applications").all()).toEqual([
      { position_id: 1, cv_path: join(cvDir, "CV_Candidate_1_acme.md"), cv_pdf_path: null, status: "review", written_by: "scrittore-1", critic_verdict: null },
    ]);
    after.close();

    // The prompt it ran on: the TUI's, with the PDF toolchain declared absent.
    const prompt = records.find((r) => r.type === "system_prompt")?.["text"] as string;
    const scrittoreMd = await readFile(join(RUNTIME, "..", "..", "agents", "scrittore", "scrittore.md"), "utf8");
    expect(prompt.slice(0, 200)).toBe(scrittoreMd.slice(0, 200));
    expect(prompt).toContain(join(root, "api", "user"));
    expect(prompt).not.toMatch(/JHT_USER_DIR/);
    const home = join(root, "api", "agents", "scrittore-1");
    const texts = [prompt];
    for (const f of (await readdir(home, { recursive: true })).filter((p) => p.endsWith(".md"))) texts.push(await readFile(join(home, f), "utf8"));
    for (const t of texts) {
      expect(t).not.toMatch(/python3/);
      expect(t).not.toMatch(/jht-throttle/);
    }
    expect(texts.join("\n")).toContain("pdf_layout_check.py (not available in the API harness)");
  });
});
