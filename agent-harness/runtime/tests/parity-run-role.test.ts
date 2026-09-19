import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openJobsDb } from "../src/db/jobs-db.ts";

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
  return roleWith({}, ...args);
}

function roleWith(env: Record<string, string>, ...args: string[]) {
  return run(process.execPath, ["--experimental-strip-types", "src/cli/run.ts", ...args], {
    cwd: RUNTIME,
    env: {
      PATH: process.env["PATH"] ?? "",
      HOME: root,
      JHT_API_HOME: join(root, "api"),
      JHT_HOME: join(root, "jht"),
      JHT_API_PROVIDER: "mock",
      ...env,
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
      // T7: the boot of a Scout on its native skills, in the runtime's jobs.db.
      ["scout_coord", "accepted"],
      ["scout_coord", "accepted"],
      ["email_monitor", "accepted"],
      ["scout_coord", "accepted"],
      ["scout_coord", "accepted"],
      ["feedback_query", "accepted"],
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

describe("npm run role with JHT_API_DB outside the runtime's home (SICUREZZA D-1)", () => {
  it("keeps the file tools off the team database the run itself uses", async () => {
    const dbFile = join(root, "jht", "db", "jobs.db");
    const script = join(root, "script.json");
    await writeFile(
      script,
      JSON.stringify([
        { toolCalls: [{ name: "scout_coord", args: { command: "claim", job_id: "https://jobs.example/1", scout: "scout-1" } }] },
        { toolCalls: [{ name: "write_file", args: { path: dbFile, content: "" } }] },
        { text: "done" },
      ]),
    );
    const { stdout } = await roleWith({ JHT_API_DB: dbFile }, "--role", "scout", "--agent", "scout-1", "--mock-script", script, "--quiet");
    const records = (await readFile(stdout.trim(), "utf8"))
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { type: string; [k: string]: unknown });
    const tools = records.filter((r) => r.type === "tool_finished").map((r) => [r["name"], r["outcome"]]);
    expect(tools).toEqual([
      ["scout_coord", "accepted"],
      ["write_file", "denied"],
    ]);
    // The claim is still there: nothing truncated the database.
    const db = openJobsDb(dbFile);
    expect(db.prepare("SELECT job_id FROM scout_claims").all()).toEqual([{ job_id: "https://jobs.example/1" }]);
    db.close();
  });
});
