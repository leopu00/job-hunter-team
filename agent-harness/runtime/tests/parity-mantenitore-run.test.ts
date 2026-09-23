/**
 * T41: `npm run role -- --role mantenitore` on the mock — a sweep of refusals.
 *
 * The MANTENITORE is the one role whose object of work IS the box: the
 * life-support daemons, the disk, the deps, the panes' locale, the archives
 * it prunes. Here an agent is a run, not a pane, so fifteen of its
 * twenty-two functions have nothing to act on. What this rehearsal pins down
 * is therefore not the sweep — it is what the role does when the sweep
 * cannot happen:
 *
 *   - every refusal says WHERE THE POWER WENT (the launcher is the
 *     CAPITANO's, the archives are the host's, the cloud is nobody's here),
 *     because a role that only hears "no" looks for another way in, and this
 *     is the role that must never work around a gate;
 *   - it measures what this box carries instead of declaring it, and what it
 *     cannot observe it reports as unknown, never as absent;
 *   - no tool of its own archives, prunes or deletes: the orphan GC lists and
 *     proposes, and the files a TUI sweep would have taken are still there
 *     when the round ends.
 *
 * And then the turn that keeps the paragraph above honest. The absence of a
 * delete TOOL is not a fence: every role carries `bash`, and on 23/09 the
 * measurement was that a shell removes whatever its uid can write — the
 * person's profile and the team's database included, in all twelve roles. So
 * the last turn reaches for the shell, and this test asserts what really
 * happens today: the file goes. The fence belongs in the mount; the day it is
 * there, this assertion turns red and has to be read, which is the point of
 * writing it down instead of claiming a boundary we do not have.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { documentPaths, onDisk } from "../src/parity/prompt-paths.ts";
import { CLI_RUN_TIMEOUT_MS } from "./helpers/cli.ts";
import { RUNTIME } from "./helpers/python-skills.ts";

const run = promisify(execFile);

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "jht-mantenitore-run-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("npm run role -- --role mantenitore (T41)", () => {
  it("measures this box, proposes instead of deleting, and leaves one line", async () => {
    // What a TUI sweep would have archived or garbage-collected. Nothing here may touch them.
    const logs = join(root, "api", "team", "logs");
    await mkdir(logs, { recursive: true });
    const sweepable = { "vitals.jsonl": "{}\n", "token-meter.csv": "ts,n\n", "orphan-script.sh": "echo hi\n" };
    for (const [name, body] of Object.entries(sweepable)) await writeFile(join(logs, name), body);

    const profileDir = join(root, "person-profile");
    await mkdir(profileDir, { recursive: true });
    await writeFile(join(profileDir, "candidate_profile.yml"), "name: A Person\ntimezone: Europe/Rome\n");
    const imageRoot = join(root, "image-app");
    await cp(join(RUNTIME, "..", "..", "agents"), join(imageRoot, "agents"), { recursive: true });

    const { stdout } = await run(
      process.execPath,
      ["--experimental-strip-types", "src/cli/run.ts", "--role", "mantenitore", "--agent", "mantenitore-1", "--turns", "2", "--pause-ms", "0", "--quiet"],
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
      ["maintainer_logbook", "accepted"],
      // Step 0 of the sweep: there are no daemons to canary.
      ["bash", "failed"],
      ["tool_health", "accepted"],
      // The archive that deletes, and the cloud write: neither is a role's here.
      ["bash", "failed"],
      ["bash", "failed"],
      // M-01: the agents are not its to steer.
      ["send_message", "failed"],
      ["send_message", "accepted"],
      ["maintainer_logbook", "accepted"],
      // The shell, which no policy of this runtime stops (measured 23/09).
      ["bash", "accepted"],
    ]);
    const results = finished.map((r) => String(r["result"]));
    expect(results[1]).toContain("No previous round");
    // Each refusal names where that power went, and none of them reads like a broken shell.
    expect(results[2]).toContain("spawn_agent");
    expect(results[4]).toContain("belong to the host that runs the team");
    expect(results[5]).toContain("not a role's to change");
    for (const refusal of [results[2], results[4], results[5]]) expect(refusal).not.toMatch(/command not found|127/);
    expect(results[6]).toContain("mantenitore.md");

    // The measurement is of THIS box: every line carries its evidence, and what
    // the run cannot observe is unknown — the test asserts the shape, never the box.
    const health = JSON.parse(results[3]!) as {
      tools_health: Record<string, { status: string; evidence: string }>;
      missing: string[];
      not_measurable: string[];
    };
    for (const [name, row] of Object.entries(health.tools_health)) {
      expect(["ok", "missing", "unknown"], name).toContain(row.status);
      expect(row.evidence.length, name).toBeGreaterThan(0);
      if (row.status === "missing") expect(row.evidence, name).toContain("not on PATH");
    }
    expect(health.not_measurable).toContain("life-support processes");
    for (const name of health.not_measurable) expect(health.missing).not.toContain(name);
    expect(records.at(-1)).toMatchObject({ type: "run_finished", reason: "completed" });

    // No tool archived, pruned or swept: the files a TUI sweep would have taken
    // are untouched — except the one the SHELL removed in the last turn, which
    // is the measurement, not the design (docs/parity.md).
    for (const [name, body] of Object.entries(sweepable)) {
      if (name === "vitals.jsonl") continue;
      expect(await readFile(join(logs, name), "utf8"), name).toBe(body);
    }
    expect(existsSync(join(logs, "vitals.jsonl")), "the shell deleted it: no mount and no allowlist stood in the way").toBe(false);
    expect(String(finished.at(-1)?.["result"])).toContain("rc=0");

    // One line for the next round, in the team's folder — the only thing it wrote.
    const entries = (await readFile(join(logs, "mantenitore-logbook.jsonl"), "utf8")).trim().split("\n");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toContain('"gc_proposed"');
    // The Capitano heard the round; the worker did not hear anything.
    const mailbox = join(root, "api", "channels", "mailbox");
    expect((await readdir(mailbox)).sort()).toEqual(["capitano-1.jsonl"]);
    const delivered = (await readFile(join(mailbox, "capitano-1.jsonl"), "utf8")).trim().split("\n");
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toContain("PROPOSED, not done");

    // The prompt is the product's, with the API harness's words for the scripts.
    const prompt = records.find((r) => r.type === "system_prompt")?.["text"] as string;
    const mantenitoreMd = await readFile(join(RUNTIME, "..", "..", "agents", "mantenitore", "mantenitore.md"), "utf8");
    expect(prompt.slice(0, 200)).toBe(mantenitoreMd.slice(0, 200));
    expect(prompt).toContain("tool_health");
    const home = join(root, "api", "agents", "mantenitore-1");
    const texts = [prompt];
    for (const f of (await readdir(home, { recursive: true })).filter((p) => p.endsWith(".md"))) texts.push(await readFile(join(home, f), "utf8"));
    for (const t of texts) expect(t).not.toMatch(/python3/);
    const referenced = [...new Set(texts.flatMap((t) => documentPaths(t, imageRoot, [home, profileDir])))];
    const optional = (p: string) => p.startsWith(`${profileDir}/`) && !p.endsWith("/candidate_profile.yml");
    expect(referenced.filter((p) => !optional(p) && !existsSync(onDisk(p, home)))).toEqual([]);
  }, CLI_RUN_TIMEOUT_MS);
});
