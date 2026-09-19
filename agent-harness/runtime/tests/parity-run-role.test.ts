import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openJobsDb } from "../src/db/jobs-db.ts";
import { rewritePythonSkills } from "../src/parity/jht-tools.ts";

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
      // T6: checked and inserted; then the same ad again, skipped by the check and refused by the insert.
      ["scout_dedup", "accepted"],
      ["db_insert", "accepted"],
      ["scout_dedup", "accepted"],
      ["db_insert", "failed"],
      ["db_query", "accepted"],
      ["send_message", "accepted"],
      ["throttle", "accepted"],
      ["check_user_replies", "accepted"],
    ]);
    expect(records.filter((r) => r.type === "turn_finished")).toHaveLength(2);
    expect(records.at(-1)).toMatchObject({ type: "run_finished", reason: "completed" });

    const scoutMd = await readFile(join(RUNTIME, "..", "..", "agents", "scout", "scout.md"), "utf8");
    const prompt = records.find((r) => r.type === "system_prompt")?.["text"] as string;
    // The TUI identity through the two documented rewrites: python3 calls (T6) and document paths (T10).
    const { createPathRewriter } = await import("../src/parity/prompt-paths.ts");
    const homeSkills = new Set(await readdir(join(root, "api", "agents", "scout-1", "skills")));
    const paths = createPathRewriter({ appRoot: join(RUNTIME, "..", ".."), homeSkills, dedupLog: join(root, "api", "logs", "scout-dedup.log") });
    expect(prompt.startsWith(paths(rewritePythonSkills(scoutMd)).trimEnd())).toBe(true);

    // One position in the runtime's jobs.db, and the second attempt was told why.
    const results = records.filter((r) => r.type === "tool_finished").map((r) => String(r["result"]));
    expect(results[7]).toBe('{"action": "insert"}');
    expect(results[8]).toMatch(/^Position inserted with ID: 1 \(company_id=NULL/);
    expect(results[9]).toBe('{"action": "skip", "level": 1, "existing_id": 1, "match": "URL esatto"}\n(exit code 10)');
    expect(results[10]).toMatch(/^\u26a0\ufe0f  DUPLICATE \(URL esatto\).*INSERT aborted\.\n\(exit code 1\)$/);
    expect(results[11]).toMatch(/^FOUND: #1 .*Mock Ltd.* \[new\]$/);
    const db = openJobsDb(join(root, "api", "db", "jobs.db"));
    expect(db.prepare("SELECT title, found_by, status FROM positions").all()).toEqual([
      { title: "Mock Engineer", found_by: "scout-1", status: "new" },
    ]);
    db.close();

    // T10: every document the prompt and the home's Markdown point at is a file this agent can open.
    const { documentPaths, onDisk } = await import("../src/parity/prompt-paths.ts");
    const { existsSync } = await import("node:fs");
    const homeDir = join(root, "api", "agents", "scout-1");
    const texts = [prompt];
    for (const f of (await readdir(homeDir, { recursive: true })).filter((p) => p.endsWith(".md"))) {
      texts.push(await readFile(join(homeDir, f), "utf8"));
    }
    const appRoot = join(RUNTIME, "..", "..");
    const referenced = [...new Set(texts.flatMap((t) => documentPaths(t, appRoot)))];
    expect(referenced.length).toBeGreaterThan(20);
    expect(referenced.filter((p) => !existsSync(onDisk(p, homeDir)))).toEqual([]);
    // Existing is not enough: read_file must open each one under the SCOUT's own policy,
    // the toolkit the run builds (a path in another role's state is refused).
    const { loadConfig } = await import("../src/config.ts");
    const { buildToolkit } = await import("../src/tools/toolkit.ts");
    const { MockProvider } = await import("../src/core/provider/mock.ts");
    const config = loadConfig({ JHT_API_HOME: join(root, "api") }, "scout-1");
    const toolkit = await buildToolkit(config, { provider: new MockProvider([]), jobsDbFile: join(root, "api", "db", "jobs.db") });
    const readFileTool = toolkit.tools.find((t) => t.spec.name === "read_file")!;
    const refused: string[] = [];
    for (const path of referenced) {
      const decision = await toolkit.permissions.decide("read_file", readFileTool.classify({ path }));
      if (!decision.allowed) refused.push(`${path}: ${decision.message ?? ""}`);
    }
    await toolkit.close();
    expect(refused).toEqual([]);
    for (const t of texts) expect(t).not.toMatch(/(?<![\w./-])(?:\/jht_home\/|\/app\/)?agents\/_(?:skills|manual|team)\//);

    // What the agent reads says nothing of python3: the prompt, and every Markdown file in its home.
    const home = join(root, "api", "agents", "scout-1");
    expect(prompt).not.toMatch(/python3/);
    const markdown = (await readdir(home, { recursive: true })).filter((p) => p.endsWith(".md"));
    expect(markdown.length).toBeGreaterThan(10);
    for (const file of markdown) expect(await readFile(join(home, file), "utf8"), file).not.toMatch(/python3/);

    // The home a TUI spawn would find, and the CAPITANO's inbox.
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

describe("npm run role and a running agent of the same id (SICUREZZA P2)", () => {
  it("refuses to start `scout` while scout-1 runs, and leaves no lock after a run", async () => {
    // A live run as scout-1: this test process holds its lock.
    const locks = join(root, "api", "locks");
    await mkdir(locks, { recursive: true });
    await writeFile(join(locks, "scout-1.lock"), JSON.stringify({ pid: process.pid, runId: "live", agent: "scout-1", startedAt: "now" }));
    const refused = await roleWith({}, "--role", "scout", "--quiet").then(
      () => null,
      (error: { code?: number; stderr?: string }) => error,
    );
    expect(refused?.code).toBe(1);
    expect(refused?.stderr).toContain("agent_running: scout-1 is already running");

    await rm(join(locks, "scout-1.lock"));
    await role("--role", "scout", "--agent", "scout-2", "--quiet");
    expect(await readdir(locks)).toEqual([]);
  });
});
