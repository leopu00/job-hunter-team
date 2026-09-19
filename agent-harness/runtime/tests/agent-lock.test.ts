import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentLock, agentInstanceId } from "../src/core/agent-lock.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jht-api-lock-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** The pid of a process that has already exited. */
function deadPid(): number {
  const child = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
  return child.pid!;
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code ?? String(error);
  }
  return "no_error";
}

describe("agentInstanceId", () => {
  it("numbers a bare name as instance 1, as start-agent.sh does", () => {
    expect(agentInstanceId("scout")).toBe("scout-1");
    expect(agentInstanceId("SCOUT-1")).toBe("scout-1");
    expect(agentInstanceId("scout-2")).toBe("scout-2");
    expect(agentInstanceId("capitano")).toBe("capitano-1");
  });
});

describe("AgentLock", () => {
  it("refuses `scout-1` while `scout` runs, and the other way round", () => {
    const scout = AgentLock.acquire({ dir, agent: "scout", runId: "a" });
    expect(codeOf(() => AgentLock.acquire({ dir, agent: "scout-1", runId: "b" }))).toBe("agent_running");
    scout.release();
    const one = AgentLock.acquire({ dir, agent: "scout-1", runId: "c" });
    expect(codeOf(() => AgentLock.acquire({ dir, agent: "scout", runId: "d" }))).toBe("agent_running");
    // A different instance is a different agent.
    AgentLock.acquire({ dir, agent: "scout-2", runId: "e" }).release();
    one.release();
    expect(existsSync(join(dir, "scout-1.lock"))).toBe(false);
  });

  it("names the run that holds the lock", () => {
    AgentLock.acquire({ dir, agent: "scout", runId: "a" });
    try {
      AgentLock.acquire({ dir, agent: "scout-1", runId: "b" });
    } catch (error) {
      expect((error as Error).message).toContain(`scout-1 is already running (pid ${process.pid}, started as 'scout'`);
      return;
    }
    throw new Error("the second run was not refused");
  });

  it("takes over a lock whose process is gone", () => {
    AgentLock.acquire({ dir, agent: "scout-1", runId: "dead-run", pid: deadPid() });
    const lock = AgentLock.acquire({ dir, agent: "scout", runId: "new-run" });
    expect(JSON.parse(readFileSync(lock.path, "utf8"))).toMatchObject({ runId: "new-run", pid: process.pid, agent: "scout" });
  });

  it("never removes a lock another run has taken over", () => {
    const old = AgentLock.acquire({ dir, agent: "scout-1", runId: "old", pid: deadPid() });
    const current = AgentLock.acquire({ dir, agent: "scout-1", runId: "current" });
    old.release();
    expect(JSON.parse(readFileSync(current.path, "utf8"))).toMatchObject({ runId: "current" });
    current.release();
    expect(existsSync(current.path)).toBe(false);
  });

  it("waits out a lock being written, and takes over one left unreadable", () => {
    const path = join(dir, "scout-1.lock");
    writeFileSync(path, "");
    expect(codeOf(() => AgentLock.acquire({ dir, agent: "scout", runId: "a" }))).toBe("agent_running");
    const past = new Date(Date.now() - 60_000);
    utimesSync(path, past, past);
    expect(codeOf(() => AgentLock.acquire({ dir, agent: "scout", runId: "b" }))).toBe("no_error");
  });

  it("counts a process it may not signal as alive", () => {
    // pid 1 exists on every system and belongs to root: kill(1, 0) is EPERM.
    AgentLock.acquire({ dir, agent: "scout-1", runId: "init", pid: 1 });
    expect(codeOf(() => AgentLock.acquire({ dir, agent: "scout", runId: "b" }))).toBe("agent_running");
  });
});
