/**
 * T42: the seven roles that have no shell here, each rehearsed.
 *
 * `bash` was in every role's hands because it is in the base toolkit, not
 * because any prompt asked for it. Measured role by role — each prompt plus
 * the SKILL.md files its `skills.list` really loads, shell blocks only, minus
 * every command that is already a tool — four of these seven had NOTHING left,
 * the MENTOR and the SENTINELLA had one spawn line, and the SCOUT had five
 * `echo` of its own diagnostics (`agents-hq/piani/MISURA-BASH-PER-RUOLO.md`).
 *
 * Taking a tool away is the part that can go wrong quietly: a role that loses
 * something it used stops and does not say so, and this team has paid for that
 * already. So the refusal is not "unknown tool" and not silence — it names
 * where that power went, as the `python3` refusals do, and the same sentence
 * is in the role's own notes. Each run below reaches for the shell and then
 * carries on: the round must still close.
 */

import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { hasShell, ROLES_WITHOUT_SHELL } from "../src/parity/shell-policy.ts";
import { CLI_RUN_TIMEOUT_MS } from "./helpers/cli.ts";
import { RUNTIME } from "./helpers/python-skills.ts";

const run = promisify(execFile);

/** What each role's refusal has to name, beyond the general half. */
const NAMES: Record<string, RegExp> = {
  analista: /native tool here/,
  scorer: /native tool here/,
  critico: /native tool here/,
  closer: /native tool here/,
  mentor: /spawn_agent|CAPITANO/,
  sentinella: /spawn_agent|CAPITANO/,
  scout: /report/,
};

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "jht-no-shell-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("the roles with no shell (T42)", () => {
  it("is the seven the measurement found, and nobody else", () => {
    expect([...ROLES_WITHOUT_SHELL].sort()).toEqual(["analista", "closer", "critico", "mentor", "scorer", "scout", "sentinella"]);
    // The five that keep it, by the MASTER's decision and until their residue is measured.
    for (const role of ["capitano", "assistente", "scrittore", "dottore", "mantenitore"]) {
      expect(hasShell(`${role}-1`), role).toBe(true);
    }
    // The instance number is not part of the question.
    expect(hasShell("scout-7")).toBe(false);
  });

  it.each(ROLES_WITHOUT_SHELL)("%s is refused with where that power went, and goes on", async (role) => {
    const profileDir = join(root, role, "profile");
    await mkdir(profileDir, { recursive: true });
    await writeFile(join(profileDir, "candidate_profile.yml"), "name: A Person\n");
    const imageRoot = join(root, role, "image-app");
    await cp(join(RUNTIME, "..", "..", "agents"), join(imageRoot, "agents"), { recursive: true });
    const script = join(root, role, "script.json");
    await writeFile(
      script,
      JSON.stringify([
        // The command the role's own skills would have run, or the one any model reaches for.
        { text: "Checking the box.", toolCalls: [{ name: "bash", args: { command: "echo check; df -h" } }] },
        {
          text: "No shell here. I say so instead of looking for another way.",
          toolCalls: [{ name: "send_message", args: { to: "capitano", text: `[@${role}-1 -> @capitano] [REQ] No shell in this harness: reporting instead.` } }],
        },
        { text: "Round closed." },
      ]),
    );

    const { stdout } = await run(
      process.execPath,
      ["--experimental-strip-types", "src/cli/run.ts", "--role", role, "--agent", `${role}-1`, "--turns", "1", "--pause-ms", "0", "--quiet", "--mock-script", script],
      {
        cwd: RUNTIME,
        env: {
          PATH: process.env["PATH"] ?? "",
          HOME: join(root, role),
          JHT_API_HOME: join(root, role, "api"),
          JHT_HOME: join(root, role, "jht"),
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
      ["bash", "failed"],
      ["send_message", "accepted"],
    ]);
    const refusal = String(finished[0]?.["result"]);
    // It is a refusal that teaches, not a broken shell and not an unknown tool.
    expect(refusal).toContain("there is no shell");
    expect(refusal).toMatch(NAMES[role]!);
    expect(refusal).toContain("say WHICH in your report");
    expect(refusal).not.toMatch(/command not found|127|no tool named/);
    // Nothing ran: the command is named as not run.
    expect(refusal).toContain("was not run");
    // And the round closed: the role reported and finished, it did not stop.
    expect(records.at(-1)).toMatchObject({ type: "run_finished", reason: "completed" });

    // The same thing is in its notes, so it knows before it tries.
    const prompt = records.find((r) => r.type === "system_prompt")?.["text"] as string;
    expect(prompt).toContain("You have no shell here");
  }, CLI_RUN_TIMEOUT_MS);
});
