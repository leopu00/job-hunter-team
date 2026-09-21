/**
 * T25: `npm run role -- --role scrittore` on the mock, as a person types it.
 * The SCRITTORE takes the position the person asked a CV for, opens the
 * anti-rewrite gate, claims it, reads the profile, writes the CV where the
 * person will find it, renders the PDF, records the application and hands it
 * to the Critic. T30: the render is `render_pdf`, whose arguments are the
 * runtime's — where the box has no toolchain the call fails with the sentence
 * that keeps the markdown as the deliverable, so this run asserts whichever
 * of the two this box is.
 */

import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openJobsDb } from "../src/db/jobs-db.ts";
import { ENGINE, PANDOC } from "../src/parity/skills/render-pdf.ts";
import { onPath } from "../src/parity/jht-tools.ts";
import { RUNTIME } from "./helpers/python-skills.ts";

/** Whether this box can really render: the image can, a laptop usually cannot. */
const RENDERS = onPath(PANDOC) && onPath(ENGINE);

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
    // The person's own documents: 750 of them on a real box, none of them the team's to change.
    const historyDir = join(root, "person-documents");
    await mkdir(historyDir, { recursive: true });
    await writeFile(join(historyDir, "CV_2024.md"), "# The CV the person wrote in 2024\n");
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
          JHT_API_USER_HISTORY_DIR: historyDir,
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
      ["render_pdf", RENDERS ? "accepted" : "failed"],
      ["read_file", "accepted"],
      ["write_file", "denied"],
      ["db_insert", "accepted"],
      ["db_update", "accepted"],
      // T35: the CRITICO of the critic-loop runs in here as a subagent, and its
      // first move is the candidate's profile — refused, by the fence.
      ["read_file", "failed"],
      ["agent", "accepted"],
      ["send_message", "accepted"],
      ["throttle", "accepted"],
      ["check_user_replies", "accepted"],
    ]);
    const results = finished.map((r) => String(r["result"]));
    expect(results[1]).toMatch(/Positions with a user-requested CV, CV rework or cover letter \(1\)/);
    expect(results[3]).toBe("No application for position 1. PROCEED.");
    expect(results[4]).toBe("Position 1 updated: status=writing");
    // The history is read freely and written by nobody: the run's own permission policy says so.
    expect(results[7]).toMatch(RENDERS ? /^Rendered .*\.md to .*\.pdf — \d+ bytes\./ : /This box has no PDF toolchain/);
    expect(results[8]).toContain("The CV the person wrote in 2024");
    expect(results[9]).toMatch(/not allowed|read-only|refused/i);
    expect(results[10]).toBe("Application inserted for position 1");
    // The SCRITTORE reads the candidate's profile freely: it writes from it.
    expect(results[5]).toContain("target_role: Backend Engineer");
    // T35: the subagent asked for the candidate's profile and was told why it
    // may not have it — by the blind fence (CR-01), not by the permission
    // policy, and the SCRITTORE that started it read that same file freely at
    // index 5. A child that inherited its parent's tools would have read it.
    expect(results[12]).toMatch(/the review is blind/i);
    expect(results[12]).toMatch(/CR-01/);
    expect(results[13]).toMatch(/SCORE: 6\.5\/10/);
    expect(await readFile(join(historyDir, "CV_2024.md"), "utf8")).toBe("# The CV the person wrote in 2024\n");
    expect(records.at(-1)).toMatchObject({ type: "run_finished", reason: "completed" });

    // The deliverable is where the person will look for it, and the row points at it.
    const cvDir = join(root, "api", "user", "cv");
    // The PDF is beside the markdown wherever the box can make one.
    expect((await readdir(cvDir)).sort()).toEqual(RENDERS ? ["CV_Candidate_1_acme.md", "CV_Candidate_1_acme.pdf"] : ["CV_Candidate_1_acme.md"]);
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
    // The prompt names both folders, and which one is the person's.
    expect(prompt).toContain(`What the team makes goes in ${join(root, "api", "user")}`);
    expect(prompt).toContain(`The person's own CVs and letters are in ${historyDir}: read them, never write there.`);
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
