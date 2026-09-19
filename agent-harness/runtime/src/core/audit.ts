/**
 * Sanitized audit trail.
 *
 * One JSON object per line. The trail records what a run *did* — how many
 * steps, how many tokens, how much money, which tool, which error code — and
 * never what it *said*. There is deliberately no event field able to hold a
 * prompt, a message, a tool argument or a provider error message: sanitisation
 * is a property of the types below, not of the discipline of the caller.
 */

import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ToolRisk } from "../tools/registry.ts";
import type { Usage } from "./usage.ts";

export type AuditEvent =
  | { type: "run_started"; providerId: string; modelId: string; live: boolean; budgetUsd: number }
  | { type: "step_started"; step: number }
  | {
      type: "step_finished";
      step: number;
      finishReason: string;
      usage: Usage;
      costUsd: number;
      toolCallNames: string[];
      durationMs: number;
    }
  | { type: "tool_rejected"; toolName: string; reason: "schema_invalid" }
  | { type: "tool_denied"; toolName: string; risk: ToolRisk; asked: boolean }
  | { type: "agent_started" }
  | { type: "agent_finished"; rounds: number; ok: boolean }
  | { type: "tool_executed"; toolName: string; ok: boolean; resultChars: number }
  | { type: "run_failed"; code: string; errorName: string }
  | { type: "run_finished"; steps: number; usage: Usage; costUsd: number };

export interface AuditRecord extends Record<string, unknown> {
  ts: string;
  runId: string;
}

export interface AuditLog {
  write(event: AuditEvent): Promise<void>;
}

/** Discards everything. The default in tests and anywhere no trail is wanted. */
export class NullAuditLog implements AuditLog {
  async write(): Promise<void> {}
}

/** Collects events in memory. Used by tests to assert on what was recorded. */
export class MemoryAuditLog implements AuditLog {
  readonly events: AuditEvent[] = [];

  async write(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }
}

/** Appends one JSON object per line to `<dir>/<runId>.jsonl`. */
export class JsonlAuditLog implements AuditLog {
  #path: string;
  #runId: string;
  #now: () => Date;
  #ready: Promise<void> | undefined;

  constructor(options: { dir: string; runId: string; now?: () => Date }) {
    this.#path = join(options.dir, `${options.runId}.jsonl`);
    this.#runId = options.runId;
    this.#now = options.now ?? (() => new Date());
  }

  get path(): string {
    return this.#path;
  }

  async write(event: AuditEvent): Promise<void> {
    this.#ready ??= mkdir(dirname(this.#path), { recursive: true }).then(() => undefined);
    await this.#ready;

    const record: AuditRecord = {
      ts: this.#now().toISOString(),
      runId: this.#runId,
      ...event,
    };
    await appendFile(this.#path, `${JSON.stringify(record)}\n`, "utf8");
  }
}
