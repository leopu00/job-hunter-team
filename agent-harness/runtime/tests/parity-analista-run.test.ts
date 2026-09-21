/**
 * T14: `npm run role -- --role analista` on the mock, as a person types it.
 * The ANALISTA takes the position the SCOUT left in `new`, reads it, extracts
 * the deadline and the rough salary, registers the company, writes the
 * analysis and moves the position to `checked`, adds a highlight and pauses:
 * every step on a native tool, nothing through a shell. The prompt it ran on
 * is the TUI's, with no python3 and with its documents where it can open them.
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
  root = await mkdtemp(join(tmpdir(), "jht-analista-run-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("npm run role -- --role analista (T14)", () => {
  it("analyses the new position on the native tools and moves it to checked, as analista-1", async () => {
    const db = openJobsDb(join(root, "api", "db", "jobs.db"));
    db.prepare("INSERT INTO positions (title, company, url, status, found_by, jd_text) VALUES (?, ?, ?, 'new', 'scout-1', ?)").run(
      "Backend Developer",
      "Acme",
      "https://acme.example/jobs/1",
      "TypeScript, hybrid in Milan. Applications close on 2099-12-31.",
    );
    db.close();
    const profileDir = join(root, "person-profile");
    await mkdir(profileDir, { recursive: true });
    await writeFile(join(profileDir, "candidate_profile.yml"), "target_role: Backend Engineer\n");
    // The image's layout: /app holds agents/ and the runtime, no shared/.
    const imageRoot = join(root, "image-app");
    await cp(join(RUNTIME, "..", "..", "agents"), join(imageRoot, "agents"), { recursive: true });

    const { stdout } = await run(
      process.execPath,
      ["--experimental-strip-types", "src/cli/run.ts", "--role", "analista", "--agent", "analista-1", "--turns", "2", "--pause-ms", "0", "--quiet"],
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
    expect(stdout.trim()).toMatch(/logs\/analista-1\/.+\.jsonl$/);
    const records = (await readFile(stdout.trim(), "utf8"))
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { type: string; [k: string]: unknown });
    const finished = records.filter((r) => r.type === "tool_finished");
    expect(finished.map((r) => [r["name"], r["outcome"]])).toEqual([
      ["read_file", "accepted"],
      ["db_query", "accepted"],
      ["db_query", "accepted"],
      ["deadline_extract", "accepted"],
      ["salary_estimate", "accepted"],
      ["db_query", "accepted"],
      ["db_query", "accepted"],
      ["db_insert", "accepted"],
      ["db_update", "accepted"],
      ["db_insert", "accepted"],
      ["throttle", "accepted"],
      ["check_user_replies", "accepted"],
    ]);
    const results = finished.map((r) => String(r["result"]));
    expect(results[1]).toMatch(/New positions ready for analysis \(1\):\n  #1 Acme/);
    expect(results[3]).toBe("2099-12-31");
    expect(results[4]).toMatch(/^\{"level": 4, .*"reason": "no_data_default"\}$/);
    expect(results[5]).toBe("Company 'Acme' not found.");
    expect(results[7]).toMatch(/^Company inserted\/updated: Acme \(ID: 1\)$/);
    expect(results[8]).toMatch(/^Position 1 updated: status=checked, notes=EXPERIENCE_REQUIRED/);
    expect(records.at(-1)).toMatchObject({ type: "run_finished", reason: "completed" });

    const after = openJobsDb(join(root, "api", "db", "jobs.db"));
    expect(
      after
        .prepare("SELECT status, loc_city, work_mode, salary_estimated_min, role_family, role_family_proposed, expires_at, last_actor, jd_summary, notes FROM positions WHERE id = 1")
        .get(),
    ).toEqual({
      status: "checked",
      loc_city: "Milan",
      work_mode: "hybrid",
      salary_estimated_min: 40000,
      // No active category yet: the write-guard parks the label as a proposal.
      role_family: "Other",
      role_family_proposed: "Backend Engineering",
      expires_at: "2099-12-31",
      last_actor: "analista-1",
      jd_summary: "**Backend Developer** at Acme, hybrid in **Milan**.\n- TypeScript services\n- Weekly releases",
      notes: "EXPERIENCE_REQUIRED: 3\nEXPERIENCE_TYPE: preferred\nDEGREE: not required\nLANGUAGE_REQUIRED: English\nSENIORITY_JD: mid\n\nA product team that ships weekly: worth a look.",
    });
    expect(after.prepare("SELECT from_state, to_state, by_agent FROM position_state_transitions").all()).toEqual([
      { from_state: "new", to_state: "checked", by_agent: "analista-1" },
    ]);
    expect(after.prepare("SELECT name, verdict, analyzed_by FROM companies").all()).toEqual([{ name: "Acme", verdict: "GO", analyzed_by: "analista-1" }]);
    expect(after.prepare("SELECT position_id, type FROM position_highlights").all()).toEqual([{ position_id: 1, type: "pro" }]);
    after.close();

    // The prompt it ran on: the TUI's, with no interpreter and the person's real profile.
    const prompt = records.find((r) => r.type === "system_prompt")?.["text"] as string;
    const analistaMd = await readFile(join(RUNTIME, "..", "..", "agents", "analista", "analista.md"), "utf8");
    expect(prompt.slice(0, 200)).toBe(analistaMd.slice(0, 200));
    expect(prompt).toContain(`${profileDir}/candidate_profile.yml`);
    expect(prompt).toContain("db_query next-for-analista");
    expect(prompt).toContain("recheck_liveness '<URL>'");
    const home = join(root, "api", "agents", "analista-1");
    const texts = [prompt];
    for (const f of (await readdir(home, { recursive: true })).filter((p) => p.endsWith(".md"))) texts.push(await readFile(join(home, f), "utf8"));
    for (const t of texts) {
      expect(t).not.toMatch(/python3/);
      expect(t).not.toMatch(/jht-throttle/);
      expect(t).not.toMatch(/(?:\$\{?JHT_HOME\}?|\/jht_home|~\/\.jht)\/profile/);
    }
    // office-geocoding's Nominatim call is the ANALISTA's own safe_fetch, with its flags.
    expect(texts.join("\n")).toMatch(/safe_fetch \\?\n?\s*--user-agent/);
    // Every document the prompt and the home point at exists.
    const referenced = [...new Set(texts.flatMap((t) => documentPaths(t, imageRoot, [home, profileDir])))];
    expect(referenced.length).toBeGreaterThan(10);
    // The profile's own state files (enrichment-policy.json) may be absent by contract: absent is the defaults.
    const optional = (p: string) => p.startsWith(`${profileDir}/`) && !p.endsWith("/candidate_profile.yml");
    expect(referenced.filter((p) => !optional(p) && !existsSync(onDisk(p, home)))).toEqual([]);
  }, CLI_RUN_TIMEOUT_MS);
});
