import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonlTrace } from "../../../agent-harness/runtime/src/core/trace.ts";
import {
  createApiAgentsStatusReader,
  parseTraceLines,
  statusFromTrace,
  TRACE_LIVE_MS,
} from "../../../cli/src/lib/agents-status-traces.js";

// The JHT API executor's traces read as the TUI's statuses (migration 089, "api").
// The traces here are written by the harness's own JsonlTrace: if the harness
// writes them elsewhere or otherwise, these go red.

const root = resolve(__dirname, "../../..");
const T0 = Date.parse("2026-09-27T21:00:00.000Z");
const at = (s: number) => new Date(T0 + s * 1000).toISOString();
const ev = (s: number, type: string, extra: object = {}) => ({ ts: at(s), type, ...extra });

describe("the rule (statusFromTrace)", () => {
  const NOW = T0 + 60_000;

  it("an open run at work is working, from the event that set it", () => {
    expect(statusFromTrace([ev(0, "run_started"), ev(1, "turn_started"), ev(50, "process_sample")], NOW)).toEqual({ status: "working", since: at(0) });
    const again = [ev(0, "run_started"), ev(10, "turn_finished"), ev(40, "message_in"), ev(41, "turn_started"), ev(55, "process_sample")];
    expect(statusFromTrace(again, NOW)).toEqual({ status: "working", since: at(40) });
  });

  it("a finished turn with nothing after it is waiting, however many samples follow", () => {
    const events = [ev(0, "run_started"), ev(1, "turn_started"), ev(10, "turn_finished"), ev(15, "process_sample"), ev(55, "process_sample")];
    expect(statusFromTrace(events, NOW)).toEqual({ status: "idle", since: at(10) });
  });

  it("a turn that ended on an accepted throttle is throttled, with no countdown", () => {
    const events = [
      ev(0, "run_started"),
      ev(1, "turn_started"),
      ev(5, "tool_started", { name: "throttle" }),
      ev(6, "tool_finished", { name: "throttle", outcome: "accepted" }),
      ev(9, "turn_finished"),
      ev(55, "process_sample"),
    ];
    expect(statusFromTrace(events, NOW)).toEqual({ status: "throttled", since: at(9) });
  });

  it("a throttle refused, one in an earlier turn, or a subagent's is not a pause", () => {
    const refused = [ev(1, "turn_started"), ev(6, "tool_finished", { name: "throttle", outcome: "denied" }), ev(9, "turn_finished"), ev(55, "process_sample")];
    expect(statusFromTrace(refused, NOW)?.status).toBe("idle");
    const earlier = [
      ev(1, "turn_started"),
      ev(3, "tool_finished", { name: "throttle", outcome: "accepted" }),
      ev(4, "turn_finished"),
      ev(20, "turn_started"),
      ev(30, "turn_finished"),
      ev(55, "process_sample"),
    ];
    expect(statusFromTrace(earlier, NOW)?.status).toBe("idle");
    const sub = [ev(1, "turn_started"), ev(6, "tool_finished", { name: "throttle", outcome: "accepted", agent: "helper" }), ev(9, "turn_finished"), ev(55, "process_sample")];
    expect(statusFromTrace(sub, NOW)?.status).toBe("idle");
  });

  it("a closed run: completed is waiting, stopped or failed is no status", () => {
    expect(statusFromTrace([ev(0, "run_started"), ev(9, "run_finished", { reason: "completed" })], NOW + 3_600_000)).toEqual({ status: "idle", since: at(9) });
    expect(statusFromTrace([ev(0, "run_started"), ev(9, "run_finished", { reason: "stopped" })], NOW)).toBeNull();
    expect(statusFromTrace([ev(0, "run_started"), ev(9, "run_failed", { code: "x" })], NOW)).toBeNull();
  });

  it("an open run gone silent is no status: its last line is not the present", () => {
    const events = [ev(0, "run_started"), ev(1, "turn_started"), ev(20, "process_sample")];
    expect(statusFromTrace(events, T0 + 20_000 + TRACE_LIVE_MS + 1)).toBeNull();
    expect(statusFromTrace([], NOW)).toBeNull();
    // a tail that is all samples does not say whether the agent works or waits
    expect(statusFromTrace([ev(40, "process_sample"), ev(55, "process_sample")], NOW)).toBeNull();
  });

  it("a line cut by the tail or broken is skipped", () => {
    const raw = `pe":"turn_started"}\n${JSON.stringify(ev(1, "turn_started"))}\nnot json\n{"ts":`;
    expect(parseTraceLines(raw)).toEqual([ev(1, "turn_started")]);
  });
});

describe("the reader, on traces the harness writes", () => {
  let dir = "";
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  function run(role: string, runId: string, clock: number[], events: object[]) {
    let i = 0;
    const trace = new JsonlTrace({ dir, role, runId, now: () => new Date(T0 + clock[i++]! * 1000) });
    for (const e of events) trace.write(e as never);
  }

  it("takes each agent's newest run, keyed by the TUI's name", async () => {
    dir = mkdtempSync(join(tmpdir(), "jht-api-logs-"));
    run("capitano-1", "2026-09-27T20-00-00-000Z-aaaaaaaa", [0, 1], [{ type: "turn_started", turn: 1 }, { type: "turn_finished", turn: 1 }]);
    run("capitano-1", "2026-09-27T21-00-00-000Z-bbbbbbbb", [0, 1], [{ type: "turn_started", turn: 1 }, { type: "round_started", round: 1 }]);
    run("scout-2", "2026-09-27T21-00-00-000Z-cccccccc", [0, 5], [
      { type: "turn_started", turn: 1 },
      { type: "turn_finished", turn: 1 },
    ]);
    run("critico-1", "2026-09-27T21-00-00-000Z-dddddddd", [0, 1], [{ type: "run_started" }, { type: "run_failed", code: "x", message: "y" }]);
    const map = await createApiAgentsStatusReader({ logsDir: dir }).read(new Date(T0 + 10_000));
    expect(map).toEqual({ capitano: { status: "working", since: at(0) }, "scout-2": { status: "idle", since: at(5) } });
  });

  it("logs that cannot be read publish nothing", async () => {
    expect(await createApiAgentsStatusReader({ logsDir: "/nowhere/at/all" }).read()).toBeNull();
  });
});

describe("the harness's words the rule reads", () => {
  const src = (p: string) => readFileSync(join(root, "agent-harness/runtime/src", p), "utf8");

  it("the event types and the run's end reasons are the trace's", () => {
    const types = src("core/trace.ts") + src("core/agent-loop.ts");
    for (const type of ["run_finished", "run_failed", "turn_started", "turn_finished", "message_in", "round_started", "tool_started", "tool_finished", "agent_started", "agent_finished", "process_sample"])
      expect(types, type).toContain(`type: "${type}"`);
    expect(types).toContain(`reason: "completed" | "stopped"`);
    expect(types).toContain(`outcome: "accepted"`);
    expect(types).toContain("`agent` names the subagent an event comes from; absent means the main agent.");
  });

  it("the pause is the tool named throttle, and a live run samples more often than TRACE_LIVE_MS", () => {
    expect(src("parity/jht-tools.ts")).toMatch(/const throttle: ToolHandler = \{\s*spec: \{\s*name: "throttle",/);
    const every = /export function sampleProcess\(sink: TraceSink, intervalMs = ([\d_]+)\)/.exec(src("core/trace.ts"));
    expect(every).not.toBeNull();
    expect(Number(every![1]!.replace(/_/g, "")) * 3).toBeLessThanOrEqual(TRACE_LIVE_MS);
  });

  it("a run id starts with its ISO time, so the greatest name is the newest run", () => {
    expect(src("cli/run.ts")).toContain("const runId = `${new Date().toISOString().replace(/[:.]/g, \"-\")}-");
  });
});
