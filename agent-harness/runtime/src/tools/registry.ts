/**
 * Tool handlers and the closed registry that holds them.
 *
 * A handler pairs a `ToolSpec` (what the model sees) with `classify` (what the
 * call would do, decided before it runs — the input to the permission check)
 * and `execute` (what the runtime does). Dispatch is closed: a name that is
 * not registered is reported back to the model, never invoked. A handler that
 * fails returns its error as text — for an agent an error is information, not
 * a crash — and only the runtime's own failures throw.
 */

import type { TurnAccount } from "../core/agent-loop.ts";
import type { ToolSpec } from "../core/provider/port.ts";
import type { ToolDetails } from "../core/trace.ts";
import type { Usage } from "../core/usage.ts";

/**
 * - `none`: touches nothing outside the session (a todo list).
 * - `read`: reads files; `paths` says which.
 * - `write`: changes files.
 * - `network`: reaches the internet — a request can carry data out as well as in.
 * - `execute`: runs a program, which can do any of the above.
 */
export type ToolRisk = "none" | "read" | "write" | "network" | "execute";

export interface ToolAccess {
  risk: ToolRisk;
  /** Every path the call reads or writes, absolute. Empty for a shell command. */
  paths: string[];
  /** One line a person can judge before allowing it: the command, or the path. */
  summary: string;
}

export interface ToolExecution {
  /** Text handed back to the model as the tool result. */
  content: string;
  /** False when the tool could not do what was asked; `content` then says why. */
  ok: boolean;
  /** Model tokens the tool spent on its own, such as a provider-run web search. */
  usage?: Usage;
  /** Spend that is not tokens, in USD, such as a per-search fee. */
  chargeUsd?: number;
  /** Structured facts for the trace — exit code, resources. Never sent to the model. */
  details?: ToolDetails;
}

/** What a running tool may know about the run around it. */
export interface ToolContext {
  /** The turn this call belongs to. A tool that runs its own model calls records them here. */
  account: TurnAccount;
  /** Wall-clock time the run has left. */
  remainingMs: () => number;
}

export interface ToolHandler {
  spec: ToolSpec;
  /** `args` have already been validated against `spec.schema`. */
  classify(args: unknown): ToolAccess;
  /** `args` have already been validated and the call has been allowed. */
  execute(args: unknown, context: ToolContext): Promise<ToolExecution>;
}

export class ToolRegistry {
  #handlers = new Map<string, ToolHandler>();

  constructor(handlers: ToolHandler[] = []) {
    for (const handler of handlers) {
      if (this.#handlers.has(handler.spec.name)) {
        throw new Error(`Duplicate tool name: ${handler.spec.name}`);
      }
      this.#handlers.set(handler.spec.name, handler);
    }
  }

  get specs(): ToolSpec[] {
    return [...this.#handlers.values()].map((h) => h.spec);
  }

  get names(): string[] {
    return [...this.#handlers.keys()];
  }

  get(name: string): ToolHandler | undefined {
    return this.#handlers.get(name);
  }
}
