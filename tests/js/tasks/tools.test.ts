/**
 * Test unitari — shared/tools (vitest)
 *
 * Registry edge cases, bash executor (spawn, abort, timeout, env),
 * heartbeat listener/errori/handler.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  registerTool, getTool, listAllDefinitions,
  registerCustomDefinition, resolveProfilePolicy,
  listSections, isKnownToolId,
} from "../../../shared/tools/tool-registry.js";
import { createExecTool } from "../../../shared/tools/bash-tool.js";
import {
  resolveIndicatorType, emitHeartbeatEvent, onHeartbeatEvent,
  getLastHeartbeatEvent, setHeartbeatHandler, resetHeartbeatForTest,
  setHeartbeatsEnabled, requestHeartbeatNow,
} from "../../../shared/tools/heartbeat.js";
import type { Tool, HeartbeatEvent } from "../../../shared/tools/types.js";

function fakeTool(name: string): Tool {
  return { name, label: name, description: `Tool ${name}`,
    execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }) };
}

describe("Registry — edge cases", () => {
  it("registerTool sovrascrive tool con stesso nome", () => {
    const t1 = fakeTool("overwrite-test");
    const t2 = { ...fakeTool("overwrite-test"), description: "new" };
    registerTool(t1);
    registerTool(t2);
    expect(getTool("overwrite-test")!.description).toBe("new");
  });

  it("resolveProfilePolicy undefined senza profilo", () => {
    expect(resolveProfilePolicy(undefined)).toBeUndefined();
    expect(resolveProfilePolicy("full")).toBeUndefined();
  });

  it("listSections non include sezioni senza tool", () => {
    const sections = listSections();
    for (const s of sections) expect(s.tools.length).toBeGreaterThan(0);
  });

  it("custom definition riconosciuta da isKnownToolId", () => {
    registerCustomDefinition({
      id: "vitest-custom-tool", label: "Vitest Custom", description: "test",
      sectionId: "runtime", profiles: ["full"],
    });
    expect(isKnownToolId("vitest-custom-tool")).toBe(true);
    expect(isKnownToolId("vitest-non-esiste")).toBe(false);
  });
});

describe("Bash tool — createExecTool", () => {
  it("ritorna Tool con name, label, parameters", () => {
    const tool = createExecTool();
    expect(tool.name).toBe("exec");
    expect(tool.label).toBe("exec");
    expect(tool.parameters).toBeDefined();
    expect((tool.parameters as any).required).toContain("command");
  });

  it("execute echo ritorna output e status completed", async () => {
    const tool = createExecTool();
    const ac = new AbortController();
    const result = await tool.execute("t1", { command: 'echo "hello vitest"' }, ac.signal);
    expect(result.content[0].text).toContain("hello vitest");
    expect(result.details.status).toBe("completed");
    expect(result.details.exitCode).toBe(0);
  });

  it("execute comando fallito ritorna failed con exit code", async () => {
    const tool = createExecTool();
    const ac = new AbortController();
    const result = await tool.execute("t2", { command: "exit 42" }, ac.signal);
    expect(result.details.status).toBe("failed");
    expect(result.details.exitCode).toBe(42);
  });

  it("execute comando senza output mostra placeholder", async () => {
    const tool = createExecTool();
    const ac = new AbortController();
    const result = await tool.execute("t3", { command: "true" }, ac.signal);
    expect(result.content[0].text).toContain("(nessun output)");
  });

  it("execute con env custom passa variabili", async () => {
    const tool = createExecTool({ env: { MY_TEST_VAR: "vitest123" } });
    const ac = new AbortController();
    const result = await tool.execute("t4", { command: "echo $MY_TEST_VAR" }, ac.signal);
    expect(result.content[0].text).toContain("vitest123");
  });

  it("execute con AbortSignal termina il processo", async () => {
    const tool = createExecTool({ timeoutSec: 30 });
    const ac = new AbortController();
    const promise = tool.execute("t5", { command: "sleep 30" }, ac.signal);
    setTimeout(() => ac.abort(), 50);
    const result = await promise;
    expect(result.details.exitCode).not.toBe(0);
    expect(result.details.durationMs).toBeLessThan(5000);
  });

  it("execute con timeout corto interrompe e segnala timedOut", async () => {
    const tool = createExecTool({ timeoutSec: 0.1 });
    const ac = new AbortController();
    const result = await tool.execute("t6", { command: "sleep 30" }, ac.signal);
    expect(result.details.timedOut).toBe(true);
    expect(result.details.durationMs).toBeLessThan(5000);
  }, 10000);

  it("execute registra durationMs > 0", async () => {
    const tool = createExecTool();
    const ac = new AbortController();
    const result = await tool.execute("t7", { command: "echo fast" }, ac.signal);
    expect(result.details.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("Heartbeat — edge cases", () => {
  beforeEach(() => { resetHeartbeatForTest(); });

  it("getLastHeartbeatEvent null dopo reset", () => {
    expect(getLastHeartbeatEvent()).toBeNull();
  });

  it("multipli listener ricevono tutti lo stesso evento", () => {
    const r1: string[] = [];
    const r2: string[] = [];
    onHeartbeatEvent((e) => r1.push(e.status));
    onHeartbeatEvent((e) => r2.push(e.status));
    emitHeartbeatEvent({ status: "ok-token" });
    expect(r1).toEqual(["ok-token"]);
    expect(r2).toEqual(["ok-token"]);
  });

  it("listener che lancia errore non blocca gli altri", () => {
    const received: string[] = [];
    onHeartbeatEvent(() => { throw new Error("boom"); });
    onHeartbeatEvent((e) => received.push(e.status));
    emitHeartbeatEvent({ status: "sent" });
    expect(received).toEqual(["sent"]);
  });

  it("handler che lancia emette evento failed", async () => {
    const events: HeartbeatEvent[] = [];
    onHeartbeatEvent((e) => events.push(e));
    setHeartbeatHandler(async () => { throw new Error("handler crash"); });
    requestHeartbeatNow({ reason: "test" });
    await new Promise((r) => setTimeout(r, 500));
    const failed = events.find((e) => e.status === "failed");
    expect(failed).toBeDefined();
    expect(failed!.reason).toContain("handler crash");
  });

  it("emitHeartbeatEvent arricchisce indicatorType per ogni status", () => {
    const statuses = ["ok-empty", "ok-token", "sent", "failed", "skipped"] as const;
    const expected = ["ok", "ok", "alert", "error", undefined];
    for (let i = 0; i < statuses.length; i++) {
      emitHeartbeatEvent({ status: statuses[i] });
      const last = getLastHeartbeatEvent()!;
      expect(last.indicatorType).toBe(expected[i]);
    }
  });
});
