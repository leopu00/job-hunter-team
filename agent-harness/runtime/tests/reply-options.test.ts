/**
 * T42b: the game's reply buttons, and the refusal that answers the right question.
 *
 * `game-reply-options` is in the `skills.list` of the MENTOR, the ASSISTENTE
 * and the CAPITANO, and it runs `jht-reply-options`: one line into the same
 * `chat.jsonl` as `jht-send`, with `choices[]` beside the text, which the game
 * renders as buttons.
 *
 * Measured before deciding anything: that command is NOT on PATH in this
 * image. A role with a shell — the ASSISTENTE, which keeps one — got
 * `command not found`, exit 127, and the buttons were already lost, silently,
 * before any role lost `bash`. So the function was not taken away here: it was
 * missing, and it is ported.
 *
 * The other half is the one the MASTER caught in review: a refusal must answer
 * the question that was asked. A MENTOR reaching for `jht-reply-options` used
 * to hear about spawning a DOTTORE, because that was the only shell line its
 * skills had — an answer to a different question, which is worse than a blunt
 * no.
 */

import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CLI_RUN_TIMEOUT_MS } from "./helpers/cli.ts";
import { RUNTIME } from "./helpers/python-skills.ts";

const run = promisify(execFile);

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "jht-reply-options-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A run of `role` on the given turns; returns the trace's records. */
async function runRole(role: string, turns: unknown[]): Promise<Array<{ type: string; [k: string]: unknown }>> {
  const home = join(root, role);
  const profileDir = join(home, "profile");
  await mkdir(profileDir, { recursive: true });
  await writeFile(join(profileDir, "candidate_profile.yml"), "name: A Person\n");
  const imageRoot = join(home, "image-app");
  await cp(join(RUNTIME, "..", "..", "agents"), join(imageRoot, "agents"), { recursive: true });
  const script = join(home, "script.json");
  await writeFile(script, JSON.stringify(turns));
  const { stdout } = await run(
    process.execPath,
    ["--experimental-strip-types", "src/cli/run.ts", "--role", role, "--agent", `${role}-1`, "--turns", "1", "--pause-ms", "0", "--quiet", "--mock-script", script],
    {
      cwd: RUNTIME,
      env: {
        PATH: process.env["PATH"] ?? "",
        HOME: home,
        JHT_API_HOME: join(home, "api"),
        JHT_HOME: join(home, "jht"),
        JHT_API_PROFILE_DIR: profileDir,
        JHT_API_APP_ROOT: imageRoot,
        JHT_API_PROVIDER: "mock",
      },
    },
  );
  return (await readFile(stdout.trim(), "utf8"))
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as { type: string; [k: string]: unknown });
}

describe("reply_options (T42b)", () => {
  it("writes the game's line, buttons and all, for a role whose skills carry it", async () => {
    const records = await runRole("mentor", [
      {
        text: "A small bounded choice.",
        toolCalls: [
          {
            name: "reply_options",
            args: { prompt: "Which part first?", choices: ["My target roles", "My profile gaps", "The best positions"] },
          },
        ],
      },
      { text: "Turn closed." },
    ]);
    const finished = records.filter((r) => r.type === "tool_finished");
    expect(finished.map((r) => [r["name"], r["outcome"]])).toEqual([["reply_options", "accepted"]]);

    const line = JSON.parse((await readFile(join(root, "mentor", "api", "agents", "mentor-1", "chat.jsonl"), "utf8")).trim()) as {
      role: string;
      text: string;
      done: boolean;
      choices: Array<{ id: string; label: string; value: string }>;
    };
    // The script's own record, field for field: the game reads this file.
    expect(line.role).toBe("assistant");
    expect(line.text).toBe("Which part first?");
    expect(line.done).toBe(true);
    expect(line.choices).toEqual([
      { id: "reply-1", label: "My target roles", value: "My target roles" },
      { id: "reply-2", label: "My profile gaps", value: "My profile gaps" },
      { id: "reply-3", label: "The best positions", value: "The best positions" },
    ]);
  }, CLI_RUN_TIMEOUT_MS);

  it("is only for the roles whose skills.list carries the game skill", async () => {
    const records = await runRole("scorer", [
      { toolCalls: [{ name: "reply_options", args: { prompt: "x", choices: ["a", "b"] } }] },
      { text: "done" },
    ]);
    const first = records.filter((r) => r.type === "tool_finished")[0];
    expect(first?.["outcome"]).toBe("unknown");
    expect(String(first?.["result"])).toContain('there is no tool named "reply_options"');
  }, CLI_RUN_TIMEOUT_MS);

  it("answers the question the MENTOR actually asked, not the one about spawning", async () => {
    const records = await runRole("mentor", [
      { toolCalls: [{ name: "bash", args: { command: "jht-reply-options --prompt 'Which first?' 'A' 'B'" } }] },
      { text: "done" },
    ]);
    const refusal = String(records.filter((r) => r.type === "tool_finished")[0]?.["result"]);
    // The buttons, not the DOTTORE.
    expect(refusal).toContain("reply_options");
    expect(refusal).not.toMatch(/spawn_agent|DOTTORE/);
    expect(refusal).not.toMatch(/command not found|127/);
  }, CLI_RUN_TIMEOUT_MS);

  it("sends a role that names the TUI's pause alias to the throttle tool (T42a)", async () => {
    for (const role of ["mentor", "assistente"]) {
      const records = await runRole(role, [{ toolCalls: [{ name: "bash", args: { command: "throttle-set scout-1 600" } }] }, { text: "done" }]);
      const refusal = String(records.filter((r) => r.type === "tool_finished")[0]?.["result"]);
      expect(refusal, role).toContain("`throttle` tool");
      expect(refusal, role).not.toMatch(/command not found|127/);
    }
  }, CLI_RUN_TIMEOUT_MS);
});
