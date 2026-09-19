/**
 * A role session: one product agent (SCOUT, ANALYST…) running on the API.
 *
 * Transport-agnostic on purpose: the session prints nothing and opens no file
 * — the tools it is given do that, and only once the permission policy allows
 * each call. A message goes in (the task, a note from another agent, a reply
 * from the user), and the agent works until it answers without calling a tool.
 * The CLI, a container entrypoint and a test are thin adapters over this one
 * object.
 *
 * The system prompt is the caller's, verbatim: roles are defined by their
 * prompts under `agents/<role>/`, and parity with the TUI agents means the
 * runtime adds nothing to what the role is told.
 */

import {
  runRound,
  ToolRunner,
  TurnAccount,
  type LoopDeps,
  type TurnStats,
} from "./agent-loop.ts";
import type { AuditLog } from "./audit.ts";
import { HarnessError } from "./errors.ts";
import type { Guardrails } from "./guardrails.ts";
import { PermissionPolicy } from "./permissions.ts";
import type { Message, ProviderPort } from "./provider/port.ts";
import { AGENT_TOOL, createAgentTool } from "./subagent.ts";
import type { TraceEvent } from "./trace.ts";
import { displayPath } from "../tools/paths.ts";
import { ToolRegistry, type ToolHandler } from "../tools/registry.ts";
import { createTodoTool, TODO_TOOL } from "../tools/todo.ts";

export type { ToolOutcome, TurnStats, TodoItem } from "./agent-loop.ts";

/**
 * Everything a transport can watch: the loop's events, plus the session's own
 * — the prompt, each message in, each turn. The trace writes them all; the
 * run-level events are the transport's.
 */
export type SessionEvent = Exclude<
  TraceEvent,
  { type: "run_started" | "run_finished" | "run_failed" | "process_sample" }
>;

/** What a turn produced: the agent's answer, once it stopped calling tools. */
export interface TurnResult {
  text: string;
  stats: TurnStats;
}

export interface RoleSessionOptions {
  provider: ProviderPort;
  guardrails: Guardrails;
  audit: AuditLog;
  /** The role's full system prompt. Sent as given. */
  systemPrompt: string;
  /** The role's tools. Absent means the agent has none. */
  tools?: ToolHandler[] | undefined;
  /**
   * Decides whether each tool call runs. Absent means the strictest useful
   * policy: calls that touch nothing run, everything else is denied.
   */
  permissions?: PermissionPolicy | undefined;
  /** Where commands start, for the subagents' brief. Absolute. */
  workdir?: string | undefined;
  /** The operating system in words, for the subagents' brief. */
  platform?: string | undefined;
  /** Adds the `agent` tool: subagents with the same tools and a fresh context. */
  subagents?: boolean | undefined;
  /** Adds the `todo_write` tool. */
  todos?: boolean | undefined;
  /** Receives every `SessionEvent` as it happens. */
  onEvent?: ((event: SessionEvent) => void) | undefined;
  now?: () => number;
}

export class RoleSession {
  #deps: LoopDeps;
  #emit: (event: SessionEvent) => void;
  #runner: ToolRunner;
  #systemPrompt: string;
  #messages: Message[] = [];
  #turn = 0;

  constructor(options: RoleSessionOptions) {
    if (!options.provider.profile.capabilities.toolCalling) {
      throw new HarnessError(
        "model_incapable",
        `A role needs tool calling; ${options.provider.profile.modelId} does not declare it.`,
      );
    }

    const emit = options.onEvent ?? (() => {});
    this.#emit = emit;
    this.#deps = {
      provider: options.provider,
      guardrails: options.guardrails,
      audit: options.audit,
      emit,
      now: options.now ?? Date.now,
    };

    const base = options.tools ?? [];
    for (const reserved of [AGENT_TOOL, TODO_TOOL]) {
      if (base.some((t) => t.spec.name === reserved)) {
        throw new HarnessError("config_invalid", `${reserved} is built in and cannot be registered.`);
      }
    }
    const permissions = options.permissions ?? new PermissionPolicy({ mode: "ask", freeReadRoots: [] });
    const workdir = options.workdir ? displayPath(options.workdir) : undefined;

    // Order is part of the prompt prefix: keep it fixed for the session.
    const builtIns: ToolHandler[] = [];
    if (options.subagents) {
      const context = [
        ...(options.platform ? [`The machine runs ${options.platform}.`] : []),
        ...(workdir ? [`The working folder is ${workdir}.`] : []),
      ];
      builtIns.push(createAgentTool({ deps: this.#deps, tools: base, permissions, context }));
    }
    if (options.todos) builtIns.push(createTodoTool((todos) => emit({ type: "todos_updated", todos })));

    this.#runner = new ToolRunner({ deps: this.#deps, registry: new ToolRegistry([...base, ...builtIns]), permissions });
    this.#systemPrompt = options.systemPrompt;
  }

  /** The system prompt, exactly as every request carries it. */
  get systemPrompt(): string {
    return this.#systemPrompt;
  }

  /** Names of every tool the agent can call. */
  get toolNames(): string[] {
    return this.#runner.registry.names;
  }

  /** The conversation so far. A copy: callers cannot mutate session state. */
  get transcript(): readonly Message[] {
    return [...this.#messages];
  }

  /**
   * Hands the agent one message and runs it until it answers. The first call
   * also records the system prompt in the trace. `from` says who wrote it: the
   * runtime (a task, a scheduled wake-up) or a person.
   */
  async send(text: string, from: "person" | "runtime" = "runtime"): Promise<TurnResult> {
    if (this.#messages.length === 0) this.#emit({ type: "system_prompt", text: this.#systemPrompt });
    if (from === "person") this.#deps.guardrails.checkInput(text);
    this.#messages.push({ role: "user", content: text });
    this.#emit({ type: "message_in", from, text });
    return this.#advance();
  }

  /**
   * Runs model calls until the agent answers without calling a tool. Every
   * round that calls one is followed by another, so the model can use the
   * result; the guardrails, not this loop, decide when that has gone on long
   * enough.
   */
  async #advance(): Promise<TurnResult> {
    const emit = this.#emit;
    const turn = new TurnAccount(this.#deps.now);
    const turnNumber = ++this.#turn;
    emit({ type: "turn_started", turn: turnNumber });

    for (;;) {
      const result = await runRound(this.#deps, {
        system: this.#systemPrompt,
        messages: this.#messages,
        tools: this.#runner.registry.specs,
        account: turn,
      });

      for (const call of result.toolCalls) {
        const content = await this.#runner.run(call, turn);
        this.#messages.push({ role: "tool", callId: call.id, name: call.name, content });
      }
      // Tool results went back to the model: it needs another round to use them.
      if (result.toolCalls.length > 0) continue;

      const stats = turn.close();
      emit({
        type: "turn_finished",
        turn: turnNumber,
        kind: "reply",
        text: result.text,
        rounds: stats.rounds,
        usage: stats.usage,
        costUsd: stats.costUsd,
        durationMs: stats.durationMs,
      });
      return { text: result.text, stats };
    }
  }
}
