import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const RUNTIME = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = promisify(execFile);

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "jht-run-role-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** `npm run role -- <args>`, as a person types it, on the mock and in a scratch home. */
function role(...args: string[]) {
  return run(process.execPath, ["--experimental-strip-types", "src/cli/run.ts", ...args], {
    cwd: RUNTIME,
    env: {
      PATH: process.env["PATH"] ?? "",
      HOME: root,
      JHT_API_HOME: join(root, "api"),
      JHT_HOME: join(root, "jht"),
      JHT_API_PROVIDER: "mock",
    },
  });
}

describe("npm run role -- --role scout (a product role)", () => {
  it("runs SCOUT from agents/scout on the native tools and traces every turn", async () => {
    const { stdout } = await role("--role", "scout", "--agent", "scout-1", "--turns", "2", "--pause-ms", "0", "--quiet");
    const tracePath = stdout.trim();
    expect(tracePath).toMatch(/logs\/scout-1\/.+\.jsonl$/);

    const records = (await readFile(tracePath, "utf8"))
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { type: string; [k: string]: unknown });
    const tools = records.filter((r) => r.type === "tool_finished").map((r) => [r["name"], r["outcome"]]);
    expect(tools).toEqual([
      ["read_file", "accepted"],
      ["send_message", "accepted"],
      ["throttle", "accepted"],
      ["check_user_replies", "accepted"],
    ]);
    expect(records.filter((r) => r.type === "turn_finished")).toHaveLength(2);
    expect(records.at(-1)).toMatchObject({ type: "run_finished", reason: "completed" });

    const scoutMd = await readFile(join(RUNTIME, "..", "..", "agents", "scout", "scout.md"), "utf8");
    const prompt = records.find((r) => r.type === "system_prompt")?.["text"] as string;
    expect(prompt.startsWith(scoutMd.trimEnd())).toBe(true);

    // The home a TUI spawn would find, and the CAPITANO's inbox.
    const home = join(root, "api", "agents", "scout-1");
    expect(await readdir(join(home, "skills"))).toContain("scout-coord");
    expect(await readFile(join(home, "AGENTS.md"), "utf8")).toContain("# Running as an API agent");
    expect(await readFile(join(root, "api", "channels", "mailbox", "capitano.jsonl"), "utf8")).toContain('"from":"scout-1"');
  });

  it("refuses flags that belong to the other kind of role", async () => {
    await expect(role("--role", "scout", "--skills", "x", "--quiet")).rejects.toMatchObject({
      stderr: expect.stringContaining("--skills is for a --prompt role"),
    });
    await expect(role("--role", "demo", "--prompt", "p.md", "--turns", "2", "--quiet")).rejects.toMatchObject({
      stderr: expect.stringContaining("are for a product role"),
    });
    await expect(role("--role", "scout", "--turns", "0", "--quiet")).rejects.toMatchObject({
      stderr: expect.stringContaining("--turns must be a whole number above zero"),
    });
  });
});
