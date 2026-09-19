/**
 * T21: `npm run role -- --role capitano` on the mock, as a person types it.
 * The CAPITANO wakes on its diary, the person's orders and the clock, reads
 * the pipeline, assigns the oldest user ticket, merges two duplicate
 * categories and pauses: every step on a native tool. Without a hub it has
 * no spawn: `start-agent.sh` is answered with the tool to use, and nothing
 * runs. Its diary is in its own state folder, never in the profile.
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
import { RUNTIME } from "./helpers/python-skills.ts";

const run = promisify(execFile);

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "jht-capitano-run-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("npm run role -- --role capitano (T21)", () => {
  it("wakes, reads the pipeline, routes a ticket and merges categories on the native tools, and spawns nothing", async () => {
    const db = openJobsDb(join(root, "api", "db", "jobs.db"));
    const pos = db.prepare("INSERT INTO positions (title, company, url, status, found_by, role_family) VALUES (?, 'Acme', ?, 'checked', 'scout-1', ?)");
    pos.run("Backend Developer", "https://acme.example/jobs/1", "Backend");
    pos.run("Backend Engineer", "https://acme.example/jobs/2", "Backend Eng");
    const family = db.prepare("INSERT INTO role_family_registry (user_id, name, status, support_count) VALUES ('local', ?, 'active', 1)");
    family.run("Backend");
    family.run("Backend Eng");
    db.prepare("INSERT INTO position_tickets (position_id, request_text, kind, status) VALUES (1, 'Is this still open?', 'custom', 'open')").run();
    db.prepare("INSERT INTO team_directives (body, kind, status, created_by) VALUES ('CV only for scores 90+', 'order', 'active', 'user')").run();
    db.close();
    const profileDir = join(root, "person-profile");
    await mkdir(profileDir, { recursive: true });
    await writeFile(join(profileDir, "candidate_profile.yml"), "target_role: Backend Engineer\ntimezone: Europe/Rome\n");
    const imageRoot = join(root, "image-app");
    await cp(join(RUNTIME, "..", "..", "agents"), join(imageRoot, "agents"), { recursive: true });

    const { stdout } = await run(
      process.execPath,
      ["--experimental-strip-types", "src/cli/run.ts", "--role", "capitano", "--agent", "capitano", "--turns", "2", "--pause-ms", "0", "--quiet"],
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
    expect(stdout.trim()).toMatch(/logs\/capitano\/.+\.jsonl$/);
    const records = (await readFile(stdout.trim(), "utf8"))
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { type: string; [k: string]: unknown });
    const finished = records.filter((r) => r.type === "tool_finished");
    expect(finished.map((r) => r["name"])).toEqual([
      "read_file", "captain_diary", "team_directives", "format_time", "db_query", "db_query", "ticket", "ticket", "role_registry", "bash", "captain_diary", "throttle", "check_user_replies",
    ]);
    const results = finished.map((r) => String(r["result"]));
    expect(results[1]).toMatch(/^📭 No previous-day diary/);
    expect(results[2]).toContain("CV only for scores 90+");
    expect(results[3]).toMatch(/^\d{2}:\d{2} CES?T$/);
    expect(results[4]).toContain("JOB HUNTER — DASHBOARD (Schema V2)");
    expect(results[5]).toMatch(/Checked positions without a score \(2\)/);
    expect(results[6]).toMatch(/^OPEN tickets \(1\)/);
    expect(results[7]).toBe("Ticket #1 assigned to analista-1.");
    expect(results[8]).toMatch(/^merge \['Backend', 'Backend Eng'\] → 'Backend Engineering'\nactive: \[\('Backend Engineering', 2\)\]$/);
    expect(results[9]).toMatch(/`start-agent.sh` does not exist here\. Use the `spawn_agent` tool instead\..*Nothing was run\./);
    expect(results[10]).toMatch(/^saved to captain-diary-\d{4}-\d{2}-\d{2}\.md$/);
    expect(finished.map((r) => r["outcome"]).filter((o) => o !== "accepted")).toHaveLength(1);
    expect(records.at(-1)).toMatchObject({ type: "run_finished", reason: "completed" });

    const after = openJobsDb(join(root, "api", "db", "jobs.db"));
    expect(after.prepare("SELECT status, assigned_agent FROM position_tickets").all()).toEqual([{ status: "assigned", assigned_agent: "analista-1" }]);
    expect(after.prepare("SELECT role_family FROM positions ORDER BY id").all()).toEqual([{ role_family: "Backend Engineering" }, { role_family: "Backend Engineering" }]);
    expect(after.prepare("SELECT name, status, merged_into FROM role_family_registry ORDER BY name").all()).toEqual([
      { name: "Backend", status: "dormant", merged_into: "Backend Engineering" },
      { name: "Backend Eng", status: "dormant", merged_into: "Backend Engineering" },
      { name: "Backend Engineering", status: "active", merged_into: null },
    ]);
    after.close();

    // The diary is the team's state, in the runtime's folder; the profile holds only what the person put there.
    expect(await readdir(join(root, "api", "team", "logs"))).toEqual([expect.stringMatching(/^captain-diary-\d{4}-\d{2}-\d{2}\.md$/)]);
    expect(await readdir(profileDir)).toEqual(["candidate_profile.yml"]);

    const prompt = records.find((r) => r.type === "system_prompt")?.["text"] as string;
    const capitanoMd = await readFile(join(RUNTIME, "..", "..", "agents", "capitano", "capitano.md"), "utf8");
    expect(prompt.slice(0, 200)).toBe(capitanoMd.slice(0, 200));
    expect(prompt).toContain("ticket list-open");
    const home = join(root, "api", "agents", "capitano");
    const texts = [prompt];
    for (const f of (await readdir(home, { recursive: true })).filter((p) => p.endsWith(".md"))) texts.push(await readFile(join(home, f), "utf8"));
    for (const t of texts) {
      expect(t).not.toMatch(/python3/);
      expect(t).not.toMatch(/jht-throttle/);
      expect(t).not.toMatch(/(?:\$\{?JHT_HOME\}?|\/jht_home|~\/\.jht)\/profile/);
    }
    const referenced = [...new Set(texts.flatMap((t) => documentPaths(t, imageRoot, [home, profileDir])))];
    const optional = (p: string) => p.startsWith(`${profileDir}/`) && !p.endsWith("/candidate_profile.yml");
    expect(referenced.filter((p) => !optional(p) && !existsSync(onDisk(p, home)))).toEqual([]);
  });
});
