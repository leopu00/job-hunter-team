/**
 * The trace: everything an agent does, as it does it.
 *
 * Agents run headless by default, so the trace is how a person sees them
 * work. It is the opposite of the audit trail: the audit records what a run
 * *did* and is safe to share; the trace records what it *said and touched* —
 * prompts, replies, tool arguments, command output, resources — so nothing an
 * agent does is hidden from the person running it. It stays on this machine,
 * under `~/.jht-api/logs`, never in the repository and never sent anywhere.
 *
 * One JSON object per line, one file per run: `<logs>/<role>/<runId>.jsonl`.
 * Lines are appended synchronously, so a run that crashes leaves a complete
 * trace up to the crash and a monitor tailing the file sees each event at once.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import type { AgentEvent } from "./agent-loop.ts";
import type { Pricing, Usage } from "./usage.ts";

/** Provider-side facts about one model call, when the provider reports them. */
export interface ResponseMeta {
  /** The provider's id for the response, to find it in their dashboard. */
  id?: string;
  /** The model that actually served the call, which can differ from the one asked for. */
  modelId?: string;
  /** Remaining request and token quota, from the provider's rate-limit headers. */
  rateLimit?: Record<string, string>;
}

/** What a finished command used, as the operating system measured it. */
export interface CommandResources {
  wallMs?: number;
  cpuUserMs?: number;
  cpuSystemMs?: number;
  maxRssBytes?: number;
}

/**
 * Everything the trace records: the loop's events (`AgentEvent`, which carry
 * rounds, tool calls and subagents), and the session and run around them.
 */
export type TraceEvent =
  | AgentEvent
  | {
      type: "run_started";
      pid: number;
      providerId: string;
      modelId: string;
      live: boolean;
      pricing: Pricing;
      budgetUsd: number;
      limits: Record<string, number>;
      permissionMode: string;
      workdir: string;
      agentHome?: string;
      tools: string[];
      /** Connected MCP servers, as "name (n tools)" or "name (failed: why)". */
      mcp?: string[];
      node: string;
      platform: string;
    }
  | { type: "system_prompt"; text: string }
  | { type: "message_in"; from: "person" | "runtime"; text: string }
  | { type: "turn_started"; turn: number }
  | {
      type: "turn_finished";
      turn: number;
      kind: "reply";
      text: string;
      rounds: number;
      usage: Usage;
      costUsd: number;
      durationMs: number;
    }
  | {
      type: "process_sample";
      rssBytes: number;
      heapUsedBytes: number;
      cpuUserMs: number;
      cpuSystemMs: number;
      /** How late the event loop ran a timer, in ms. High means the agent process is starved. */
      loopLagMs: number;
    }
  | { type: "run_failed"; code: string; message: string }
  | {
      type: "run_finished";
      reason: "completed" | "stopped";
      steps: number;
      toolCalls: number;
      usage: Usage;
      costUsd: number;
      /** Searches the provider ran in the run (T19). Absent in traces written before. */
      webSearches?: number;
      durationMs: number;
    };

/** Structured facts a tool can report beside its text result. */
export interface ToolDetails {
  exitCode?: number | null;
  signal?: string | null;
  timedOut?: boolean;
  stdoutBytes?: number;
  stderrBytes?: number;
  resources?: CommandResources;
  [key: string]: unknown;
}

export interface TraceRecord extends Record<string, unknown> {
  ts: string;
  seq: number;
  runId: string;
  role: string;
  type: TraceEvent["type"];
}

export type TraceSink = (event: TraceEvent) => void;

/** A record as written to the file: the event plus when, where and in which order. */
export type TraceLine = TraceRecord & TraceEvent;

/** Appends every event to `<dir>/<role>/<runId>.jsonl`, readable only by the owner. */
export class JsonlTrace {
  readonly path: string;
  readonly runId: string;
  readonly role: string;
  #seq = 0;
  #now: () => Date;

  constructor(options: { dir: string; role: string; runId: string; now?: () => Date }) {
    this.path = join(options.dir, options.role, `${options.runId}.jsonl`);
    this.runId = options.runId;
    this.role = options.role;
    this.#now = options.now ?? (() => new Date());
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
  }

  /** Appends the event and returns the record as written, for a live view to show the same thing. */
  readonly write = (event: TraceEvent): TraceLine => {
    const record = { ts: this.#now().toISOString(), seq: ++this.#seq, runId: this.runId, role: this.role, ...event } as TraceLine;
    appendFileSync(this.path, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
    return record;
  };
}

/** One sink feeding several. */
export function fanout(...sinks: TraceSink[]): TraceSink {
  return (event) => {
    for (const sink of sinks) sink(event);
  };
}

/** Writes to the trace first, then hands the written record — timestamp and run id included — to `view`. */
export function traceThen(trace: JsonlTrace, view: (record: TraceLine) => void): TraceSink {
  return (event) => view(trace.write(event));
}

/**
 * Samples the agent process every `intervalMs`: memory, CPU and event-loop
 * lag. Returns a function that takes a last sample and stops.
 */
export function sampleProcess(sink: TraceSink, intervalMs = 5_000): () => void {
  let expected = Date.now() + intervalMs;
  const sample = (loopLagMs: number) => {
    const memory = process.memoryUsage();
    const cpu = process.cpuUsage();
    sink({
      type: "process_sample",
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      cpuUserMs: Math.round(cpu.user / 1000),
      cpuSystemMs: Math.round(cpu.system / 1000),
      loopLagMs,
    });
  };
  const timer = setInterval(() => {
    const now = Date.now();
    sample(Math.max(0, now - expected));
    expected = now + intervalMs;
  }, intervalMs);
  timer.unref();
  return () => {
    clearInterval(timer);
    sample(0);
  };
}
