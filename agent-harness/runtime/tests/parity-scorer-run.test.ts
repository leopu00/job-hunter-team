/**
 * T15: `npm run role -- --role scorer` on the mock, as a person types it. The
 * SCORER takes the position the ANALISTA left in `checked`, reads the
 * feedback themes, claims it, scores it on the native db_insert behind
 * profile_gate, moves it to `scored` and reports; nothing goes through a shell.
 */

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openJobsDb } from "../src/db/jobs-db.ts";
import { RUNTIME } from "./helpers/python-skills.ts";

const run = promisify(execFile);

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "jht-scorer-run-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A database with one analysed position, and the person's profile; `profile` null leaves it out. */
async function scorerRun(profile: string | null) {
  const db = openJobsDb(join(root, "api", "db", "jobs.db"));
  db.prepare("INSERT INTO positions (title, company, url, status, found_by, jd_text) VALUES (?, ?, ?, 'checked', 'scout-1', ?)").run(
    "Backend Developer",
    "Acme",
    "https://acme.example/jobs/1",
    "TypeScript, hybrid in Milan.",
  );
  db.close();
  const profileDir = join(root, "person-profile");
  await mkdir(profileDir, { recursive: true });
  if (profile !== null) await writeFile(join(profileDir, "candidate_profile.yml"), profile);

  const { stdout } = await run(
    process.execPath,
    ["--experimental-strip-types", "src/cli/run.ts", "--role", "scorer", "--agent", "scorer-1", "--turns", "2", "--pause-ms", "0", "--quiet"],
    {
      cwd: RUNTIME,
      env: {
        PATH: process.env["PATH"] ?? "",
        HOME: root,
        JHT_API_HOME: join(root, "api"),
        JHT_HOME: join(root, "jht"),
        JHT_API_PROFILE_DIR: profileDir,
        JHT_API_PROVIDER: "mock",
      },
    },
  );
  const records = (await readFile(stdout.trim(), "utf8"))
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as { type: string; [k: string]: unknown });
  const finished = records.filter((r) => r.type === "tool_finished");
  return { stdout: stdout.trim(), records, finished, profileDir };
}

describe("npm run role -- --role scorer (T15)", () => {
  it("scores the checked position on the native tools, as scorer-1", async () => {
    const { stdout, records, finished } = await scorerRun("name: Ada Example\ntarget_role: Backend Engineer\nskills: [typescript]\n");
    expect(stdout).toMatch(/logs\/scorer-1\/.+\.jsonl$/);
    expect(finished.map((r) => [r["name"], r["outcome"]])).toEqual([
      ["read_file", "accepted"],
      ["db_query", "accepted"],
      ["feedback_query", "accepted"],
      ["db_update", "accepted"],
      ["db_query", "accepted"],
      ["db_insert", "accepted"],
      ["db_update", "accepted"],
      ["send_message", "accepted"],
      ["throttle", "accepted"],
      ["check_user_replies", "accepted"],
    ]);
    const results = finished.map((r) => String(r["result"]));
    expect(results[1]).toContain("Backend Developer");
    expect(results[2]).toContain("no-signal:cloud-disabled");
    expect(results[5]).toBe("Score inserted for position 1: 72/100");
    expect(records.at(-1)).toMatchObject({ type: "run_finished", reason: "completed" });

    const db = openJobsDb(join(root, "api", "db", "jobs.db"));
    expect(db.prepare("SELECT position_id, total_score, stack_match, experience_fit, scored_by FROM scores").all()).toEqual([
      { position_id: 1, total_score: 72, stack_match: 30, experience_fit: 7, scored_by: "scorer-1" },
    ]);
    const position = db.prepare("SELECT status, last_checked IS NOT NULL AS claimed FROM positions WHERE id = 1").get();
    expect(position).toEqual({ status: "scored", claimed: 1 });
    db.close();

    // The TUI prompt, with its python3 lines pointing at the tools: safe_fetch is web_fetch.
    const prompt = records.find((r) => r.type === "system_prompt")?.["text"] as string;
    expect(prompt).not.toMatch(/python3|safe_fetch\.py/);
    expect(prompt).toContain("web_fetch 'URL'");
    expect(prompt).toContain("db_insert score");
  });

  it("writes no score when the person's profile is missing, and says why", async () => {
    const { finished } = await scorerRun(null);
    const insert = finished.find((r) => r["name"] === "db_insert");
    expect(insert).toMatchObject({ outcome: "failed", result: expect.stringContaining("SCORE REJECTED: candidate profile is missing") });
    const db = openJobsDb(join(root, "api", "db", "jobs.db"));
    expect(db.prepare("SELECT count(*) AS n FROM scores").get()).toEqual({ n: 0 });
    db.close();
  });
});
