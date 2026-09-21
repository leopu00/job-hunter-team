/**
 * T40: `npm run role -- --role mentor` on the mock — the daily pass.
 *
 * The MENTOR is the one voice that may tell the person "halt, it is a craft
 * you lack, not a position", and its whole authority rests on two things its
 * prompt says of itself: it only READS (M-04: never db_insert / db_update,
 * never the profile) and it speaks to the PERSON — the reasons they type are
 * spoken back to them, "never to the Scout" (mentor-patterns, Pattern F).
 *
 * In the TUI both are sentences. Here both are fences, and this run tries
 * each one: a write to a position it is judging, which finds no tool to make
 * it (its DB policy reads and writes nothing, and no write tool is built for
 * it); a message to a worker, refused by the peer table. What goes
 * through is what it is for — the records read as sets, the outcome funnel
 * of what was sent (Pattern D, `db_query applications`, ported for this
 * role), and one number to the person.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openJobsDb } from "../src/db/jobs-db.ts";
import { documentPaths, onDisk } from "../src/parity/prompt-paths.ts";
import { CLI_RUN_TIMEOUT_MS } from "./helpers/cli.ts";
import { RUNTIME } from "./helpers/python-skills.ts";

const run = promisify(execFile);

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "jht-mentor-run-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("npm run role -- --role mentor (T40)", () => {
  it("reads the sets, counts, tells the person — and moves nothing and nobody", async () => {
    const db = openJobsDb(join(root, "api", "db", "jobs.db"));
    const position = db.prepare("INSERT INTO positions (title, company, url, status, found_by, notes) VALUES (?, ?, ?, ?, 'scout-1', ?)");
    position.run("Staff Engineer", "Acme", "https://jobs.example/1", "excluded", "ESCLUSA: [SENIORITY] staff level");
    position.run("Principal Engineer", "Beta", "https://jobs.example/2", "scored", null);
    position.run("Backend Engineer", "Gamma", "https://jobs.example/3", "excluded", "ESCLUSA: [GEO] onsite only");
    db.prepare(
      "INSERT INTO applications (position_id, status, written_by, applied, applied_at, applied_via, response) " +
        "VALUES (3, 'applied', 'scrittore-1', 1, datetime('now', '-40 days'), 'email', 'rejected')",
    ).run();
    const snapshot = (d: typeof db) => ({
      positions: d.prepare("SELECT id, status, notes FROM positions ORDER BY id").all(),
      applications: d.prepare("SELECT position_id, status, applied, response FROM applications ORDER BY id").all(),
    });
    const before = snapshot(db);
    db.close();

    const profileDir = join(root, "person-profile");
    await mkdir(profileDir, { recursive: true });
    const profile = "name: A Person\ntarget_role: Senior Backend Engineer\nseniority_target: senior\n";
    await writeFile(join(profileDir, "candidate_profile.yml"), profile);
    const imageRoot = join(root, "image-app");
    await cp(join(RUNTIME, "..", "..", "agents"), join(imageRoot, "agents"), { recursive: true });

    const { stdout } = await run(
      process.execPath,
      ["--experimental-strip-types", "src/cli/run.ts", "--role", "mentor", "--agent", "mentor-1", "--turns", "2", "--pause-ms", "0", "--quiet"],
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
      ["check_user_replies", "accepted"],
      ["read_file", "accepted"],
      ["db_query", "accepted"],
      ["db_query", "accepted"],
      ["feedback_query", "accepted"],
      // M-04: the pipeline it judges is not its to move — and the tool that
      // would move it is not in its hands at all: no db-update in its skills.
      ["db_update", "unknown"],
      // Pattern F: the person's reasons are not a search order for a worker.
      ["send_message", "failed"],
      ["chat_reply", "accepted"],
      ["throttle", "accepted"],
      ["check_user_replies", "accepted"],
    ]);
    const results = finished.map((r) => String(r["result"]));
    expect(results[2]).toContain("name: A Person");
    expect(results[3]).toContain("Staff Engineer");
    expect(results[3]).not.toContain("Principal Engineer");
    // Pattern D: the funnel of what was sent, with the sample floor said out loud.
    expect(results[4]).toContain("APPLICATIONS — 1 sent in all time");
    expect(results[4]).toMatch(/rejected\s+1\s+100\.0%/);
    expect(results[4]).toContain("Sample too small");
    expect(results[6]).toContain('there is no tool named "db_update"');
    expect(results[7]).toContain("mentor.md");
    expect(results[7]).toMatch(/Nothing was sent/);
    expect(records.at(-1)).toMatchObject({ type: "run_finished", reason: "completed" });

    // Nothing moved: not a status, not a note, not an application.
    const after = openJobsDb(join(root, "api", "db", "jobs.db"));
    expect(snapshot(after)).toEqual(before);
    after.close();
    // Not the profile either: it suggests, the person decides.
    expect(await readFile(join(profileDir, "candidate_profile.yml"), "utf8")).toBe(profile);
    // Nobody in the team heard from it; the person did, once.
    expect(existsSync(join(root, "api", "channels", "mailbox"))
      ? await readdir(join(root, "api", "channels", "mailbox"))
      : []).toEqual([]);
    const home = join(root, "api", "agents", "mentor-1");
    const chat = (await readFile(join(home, "chat.jsonl"), "utf8")).trim().split("\n");
    expect(chat).toHaveLength(1);
    expect(chat[0]).toContain("A Person, I have counted.");

    // The prompt is the product's, with the API harness's words for the scripts.
    const prompt = records.find((r) => r.type === "system_prompt")?.["text"] as string;
    const mentorMd = await readFile(join(RUNTIME, "..", "..", "agents", "mentor", "mentor.md"), "utf8");
    expect(prompt.slice(0, 200)).toBe(mentorMd.slice(0, 200));
    expect(prompt).toContain("db_query");
    const texts = [prompt];
    for (const f of (await readdir(home, { recursive: true })).filter((p) => p.endsWith(".md"))) texts.push(await readFile(join(home, f), "utf8"));
    for (const t of texts) {
      expect(t).not.toMatch(/python3/);
      expect(t).not.toMatch(/(?:\$\{?JHT_HOME\}?|\/jht_home|~\/\.jht)\/profile/);
    }
    const referenced = [...new Set(texts.flatMap((t) => documentPaths(t, imageRoot, [home, profileDir])))];
    const optional = (p: string) => p.startsWith(`${profileDir}/`) && !p.endsWith("/candidate_profile.yml");
    expect(referenced.filter((p) => !optional(p) && !existsSync(onDisk(p, home)))).toEqual([]);
  }, CLI_RUN_TIMEOUT_MS);
});
