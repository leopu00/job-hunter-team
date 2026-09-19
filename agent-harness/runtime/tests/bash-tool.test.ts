import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createBashTool, parseTimeReport, scrubEnv } from "../src/tools/bash.ts";
import { TurnAccount } from "../src/core/agent-loop.ts";
import type { ToolHandler } from "../src/tools/registry.ts";

const CONTEXT = { account: new TurnAccount(Date.now), remainingMs: () => 60_000 };

let dir: string;
let bash: ToolHandler;

const run = (args: Record<string, unknown>) => bash.execute(bash.spec.schema.parse(args), CONTEXT);

beforeAll(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), "jht-api-bash-")));
  bash = createBashTool({ workdir: dir });
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("bash tool", () => {
  it("returns the exit code and stdout", async () => {
    expect(await run({ command: "echo hello" })).toMatchObject({ ok: true, content: "exit code 0\n--- stdout ---\nhello" });
  });

  it("reports exit code, output sizes and resources as details, outside the text", async () => {
    const result = await run({ command: "echo oops >&2; echo hi; exit 3" });
    expect(result.details).toMatchObject({ exitCode: 3, signal: null, timedOut: false, stdoutBytes: 3, stderrBytes: 5 });
    expect(result.details?.resources?.wallMs).toBeGreaterThanOrEqual(0);
    expect(result.content).not.toContain("maximum resident");
  });

  it("parses BSD and GNU time reports", () => {
    expect(parseTimeReport("        0.02 real         0.01 user         0.00 sys\n   1212416  maximum resident set size\n")).toEqual({
      cpuUserMs: 10,
      cpuSystemMs: 0,
      maxRssBytes: 1212416,
    });
    expect(parseTimeReport("\tUser time (seconds): 0.25\n\tSystem time (seconds): 0.05\n\tMaximum resident set size (kbytes): 2048\n")).toEqual({
      cpuUserMs: 250,
      cpuSystemMs: 50,
      maxRssBytes: 2048 * 1024,
    });
  });

  it("reports a failing command with its stderr, as a result and not a throw", async () => {
    const result = await run({ command: "echo oops >&2; exit 3" });
    expect(result).toMatchObject({ ok: false, content: "exit code 3\n--- stderr ---\noops" });
  });

  it("says so when there is no output", async () => {
    expect((await run({ command: "true" })).content).toBe("exit code 0\n(no output)");
  });

  it("starts in the working folder", async () => {
    expect((await run({ command: "pwd -P" })).content).toContain(dir);
  });

  it("kills a command that outlives its timeout, with its children", async () => {
    const started = Date.now();
    const result = await run({ command: "sleep 30 & sleep 30; echo never", timeout_ms: 1_000 });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(result.ok).toBe(false);
    expect(result.content).toContain("timed out after 1s");
    expect(result.content).not.toContain("never");
  });

  it("gives the command no stdin", async () => {
    expect((await run({ command: "cat; echo done" })).content).toContain("done");
  });

  it("keeps credentials out of the command's environment", async () => {
    process.env["JHT_API_TEST_API_KEY"] = "sk-should-not-leak";
    try {
      const result = await run({ command: "env" });
      expect(result.content).not.toContain("sk-should-not-leak");
    } finally {
      delete process.env["JHT_API_TEST_API_KEY"];
    }
    expect(scrubEnv({ OPENAI_API_KEY: "x", GH_TOKEN: "y", PATH: "/bin", HOME: "/h" })).toEqual({ PATH: "/bin", HOME: "/h" });
  });

  it("classifies every command as execute, summarised on one line", () => {
    expect(bash.classify({ command: "ls -la\n  ~/Documents" })).toEqual({
      risk: "execute",
      paths: [],
      summary: "ls -la ~/Documents",
    });
  });
});
