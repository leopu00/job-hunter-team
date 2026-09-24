/**
 * T27-c: the CAPITANO delegates at the FIRST attempt — a rehearsal of the whole
 * path, from the CLI through the hub to the launcher's log.
 *
 * What it costs when it does not, counted by VPS off `launcher.log` over five
 * live rounds (23-24/09): 5 rounds lost to `sonnet`, asked for in EVERY round —
 * it learned inside one negotiation and started over in the next — 4 to a cap
 * outside its window, 2 to instances or spawns. Nine of those eleven were
 * requests paid for to hear a rule. And the fifth round shows what that really
 * costs: with a 0.12 USD cap the CAPITANO never reached a delegation at all, it
 * ran out first; with 0.30, in the round before, it got there.
 *
 * The fix is not a clearer refusal — the refusals were already good, and are
 * untouched. It is that the constraint now travels with the tool, read from
 * `Launcher.limits()`, the same fields the launcher refuses on.
 *
 * So this test does not hand the run any value of its own: the mock script's
 * delegation is built from the launcher's config object, the one the hub will
 * judge it by. One `spawn_agent` call, accepted, and a log with a `spawned` line
 * and no `refused` one — one round per delegation, where the live rounds spent
 * three.
 */

import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile, mkdtemp } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createHub } from "../src/hub/server.ts";
import { Launcher, type LauncherConfig } from "../src/hub/launcher.ts";
import { CLI_RUN_TIMEOUT_MS } from "./helpers/cli.ts";
import { RUNTIME } from "./helpers/python-skills.ts";

const run = promisify(execFile);
const CAPITANO_TOKEN = "c".repeat(40);

/** The launcher's rules for this rehearsal. The script below reads its values from here. */
const CONFIG: LauncherConfig = {
  session: "first-shot",
  sessionUsd: 1.5,
  captainUsd: 0.3,
  roles: { scorer: { capUsd: 0.2, instances: 1 }, scout: { capUsd: 0.2, instances: 2 } },
  maxActive: 2,
  maxSpawns: 4,
  maxFailures: 2,
  maxMinutes: 30,
  models: ["gpt-5.6-luna"],
  taskChars: 2_000,
  spawnReserveUsd: 0,
};

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "jht-first-shot-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("the CAPITANO's first delegation (T27-c)", () => {
  it("goes through at the first call, with no refusal in the launcher's log", async () => {
    const server = createHub({
      tokens: new Map([[CAPITANO_TOKEN, "capitano-1"]]),
      dbPath: join(root, "hub", "jobs.db"),
      channelsDir: join(root, "hub", "channels"),
      stateDir: join(root, "hub", "state"),
      appRoot: join(RUNTIME, "..", ".."),
      launcher: new Launcher({
        config: CONFIG,
        stateDir: join(root, "launcher"),
        spoolDir: join(root, "spool"),
        stopFile: join(root, "STOP"),
      }),
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    try {
      // The delegation the CAPITANO would write once it has read the rule: the
      // role's own window and the one allowed model, taken from the config the
      // launcher will check — never a second list of numbers.
      const script = [
        { text: "The queue needs a Scorer. The tool says which model and which window.", toolCalls: [{ name: "spawn_agent", args: { role: "scorer", cap_usd: CONFIG.roles["scorer"]!.capUsd, model: CONFIG.models[0], task: "Score the checked positions." } }] },
        { text: "Started at the first attempt." },
      ];
      await mkdir(join(root, "api"), { recursive: true });
      const scriptPath = join(root, "api", "capitano-delegates.json");
      await writeFile(scriptPath, JSON.stringify(script));

      const { stdout } = await run(
        process.execPath,
        ["--experimental-strip-types", "src/cli/run.ts", "--role", "capitano", "--agent", "capitano-1", "--turns", "1", "--pause-ms", "0", "--quiet", "--mock-script", scriptPath],
        {
          cwd: RUNTIME,
          env: {
            PATH: process.env["PATH"] ?? "",
            HOME: root,
            JHT_API_HOME: join(root, "api"),
            JHT_HOME: join(root, "jht"),
            JHT_API_PROVIDER: "mock",
            JHT_HUB_URL: url,
            JHT_HUB_TOKEN: CAPITANO_TOKEN,
          },
        },
      );

      const records = (await readFile(stdout.trim(), "utf8"))
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l) as { type: string; [k: string]: unknown });
      const spawns = records.filter((r) => r.type === "tool_finished" && r["name"] === "spawn_agent");
      // One attempt, and it was accepted: this is the measurement.
      expect(spawns).toHaveLength(1);
      expect(spawns[0]).toMatchObject({ outcome: "accepted" });
      expect(String(spawns[0]!["result"])).toContain('"agent": "scorer-1"');
      expect(records.at(-1)).toMatchObject({ type: "run_finished", reason: "completed" });

      // And the launcher's own log, where VPS did the counting: one line, `spawned`.
      const log = (await readFile(join(root, "launcher", "launcher.log"), "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { event: string; model?: string; cap_usd?: number });
      expect(log.map((e) => e.event)).toEqual(["spawned"]);
      expect(log[0]).toMatchObject({ model: "gpt-5.6-luna", cap_usd: 0.2 });
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  }, CLI_RUN_TIMEOUT_MS);
});
