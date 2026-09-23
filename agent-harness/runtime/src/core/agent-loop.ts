/**
 * The pieces every agent loop in the runtime is made of.
 *
 * `runRound` is one model call with its accounting; `ToolRunner` is one tool
 * call end to end. The role session strings them into a run, a subagent
 * strings them into a task, and every product role strings them into its own — so a guardrail, an audit event or a permission check lives
 * here once instead of once per agent.
 */

import { z } from "zod";

import type { PermissionPolicy } from "./permissions.ts";
import type { AuditLog } from "./audit.ts";
import type { Guardrails } from "./guardrails.ts";
import type { GenerateResult, Message, ProviderPort, ToolSpec } from "./provider/port.ts";
import type { ResponseMeta, ToolDetails } from "./trace.ts";
import { addUsage, inputCostUsd, totalTokens, worstCase, ZERO_USAGE, type Usage } from "./usage.ts";
import { cap } from "../tools/output.ts";
import type { ToolExecution, ToolRegistry, ToolRisk } from "../tools/registry.ts";

/**
 * What one tool call came to. `accepted` ran; `failed` ran and reported an
 * error the model can act on; `rejected` did not validate against the schema;
 * `denied` was stopped by the permission policy; `unknown` is a name the agent
 * does not have.
 */
export interface ToolOutcome {
  name: string;
  outcome: "accepted" | "failed" | "rejected" | "denied" | "unknown";
}

/**
 * What one turn cost. A turn is everything between two things the person
 * sees, so it may span many model calls — its own, and its subagents'. This is
 * what a transport shows after each prompt; it exists so the terminal, a
 * window or a web page all report the same numbers.
 */
export interface TurnStats {
  /** Model calls in this turn, subagents included. */
  rounds: number;
  usage: Usage;
  /** Tokens plus per-call charges such as web searches. */
  costUsd: number;
  durationMs: number;
  tools: ToolOutcome[];
}

export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

/**
 * What happens inside a turn, as it happens. The trace (`trace.ts`) writes
 * every one to disk and the terminal renders them, so these carry everything a
 * person needs to see what an agent did: the text of each round, every tool
 * call with its arguments and result, the permission decision, usage, cost and
 * what a command used. The audit trail, which is sanitised, never sees them.
 *
 * `agent` names the subagent an event comes from; absent means the main agent.
 */
export type AgentEvent =
  | { type: "round_started"; round: number; messages: number; contextChars: number; agent?: string }
  | {
      type: "round_finished";
      round: number;
      durationMs: number;
      finishReason: string;
      usage: Usage;
      costUsd: number;
      costInUsd: number;
      costOutUsd: number;
      text: string;
      toolCalls: { id: string; name: string; args: unknown }[];
      response?: ResponseMeta;
      /**
       * Present only when the provider refused with a 429 and the runtime
       * waited: the attempts it took and the milliseconds spent waiting. That
       * time is NOT in `durationMs` — waiting for an upstream queue is not
       * work, and a trace that counted it as work would read a rate limit as a
       * slow model (MASTER, 23/09).
       */
      backoff?: { attempts: number; waitedMs: number };
      /** Run totals after this round, against the limits. */
      run: { steps: number; toolCalls: number; totalTokens: number; costUsd: number; webSearches: number; remainingMs: number };
      agent?: string;
    }
  | {
      type: "tool_started";
      round: number;
      callId: string;
      name: string;
      args: unknown;
      risk?: ToolRisk;
      paths?: string[];
      summary: string;
      agent?: string;
    }
  | {
      type: "tool_permission";
      callId: string;
      name: string;
      mode: string;
      allowed: boolean;
      asked: boolean;
      message?: string;
      agent?: string;
    }
  | {
      type: "tool_finished";
      callId: string;
      name: string;
      outcome: ToolOutcome["outcome"];
      durationMs: number;
      resultChars: number;
      /** What went back to the model, cut to `TRACE_RESULT_CHARS`. */
      result: string;
      resultCut: boolean;
      details?: ToolDetails;
      /** Spend inside the call itself, such as a web search. Zero for most tools. */
      costUsd?: number;
      agent?: string;
    }
  | { type: "agent_started"; agent: string; prompt: string }
  | { type: "agent_finished"; agent: string; rounds: number; ok: boolean; report: string }
  | { type: "todos_updated"; todos: TodoItem[] };

/** How much of a tool result the trace keeps. The model may have received more. */
export const TRACE_RESULT_CHARS = 4_000;

/** The `tool_finished` event for one call, with its result cut for the trace. */
export function toolFinished(
  call: { callId: string; name: string; agent?: string | undefined },
  outcome: ToolOutcome["outcome"],
  result: string,
  extra: { durationMs?: number; details?: ToolDetails | undefined; costUsd?: number } = {},
): AgentEvent {
  return {
    type: "tool_finished",
    callId: call.callId,
    name: call.name,
    outcome,
    durationMs: extra.durationMs ?? 0,
    resultChars: result.length,
    result: result.slice(0, TRACE_RESULT_CHARS),
    resultCut: result.length > TRACE_RESULT_CHARS,
    ...(extra.details ? { details: extra.details } : {}),
    ...(extra.costUsd ? { costUsd: extra.costUsd } : {}),
    ...(call.agent === undefined ? {} : { agent: call.agent }),
  };
}

/** What every loop needs from the runtime. */
export interface LoopDeps {
  provider: ProviderPort;
  guardrails: Guardrails;
  audit: AuditLog;
  emit: (event: AgentEvent) => void;
  now: () => number;
}

/** Longest a single model call may take before it counts as stuck. */
const STEP_TIMEOUT_MS = 120_000;

/** Accumulates one turn's numbers; `close()` freezes them into `TurnStats`. */
export class TurnAccount {
  readonly tools: ToolOutcome[] = [];
  #rounds = 0;
  #usage: Usage = ZERO_USAGE;
  #costUsd = 0;
  #startedAt: number;
  #now: () => number;

  constructor(now: () => number) {
    this.#now = now;
    this.#startedAt = now();
  }

  /** One model call. */
  record(usage: Usage, costUsd: number): void {
    this.#rounds += 1;
    this.charge(usage, costUsd);
  }

  /** Spend that is not a round of this loop: a search a tool ran, say. */
  charge(usage: Usage, costUsd: number): void {
    this.#usage = addUsage(this.#usage, usage);
    this.#costUsd += costUsd;
  }

  get rounds(): number {
    return this.#rounds;
  }

  close(): TurnStats {
    return {
      rounds: this.#rounds,
      usage: this.#usage,
      costUsd: this.#costUsd,
      durationMs: this.#now() - this.#startedAt,
      tools: [...this.tools],
    };
  }
}

/**
 * One model call: claims a step, calls the provider under the time left,
 * accounts and audits it, and appends the assistant message to `messages`.
 */
export async function runRound(
  deps: LoopDeps,
  request: { system: string; messages: Message[]; tools: ToolSpec[]; account: TurnAccount; agent?: string | undefined },
): Promise<GenerateResult> {
  const { guardrails, audit, emit, now } = deps;
  const label = request.agent === undefined ? {} : { agent: request.agent };

  guardrails.beginStep();
  // The round's worst case must fit before it starts: the whole context at
  // full input price, written to the cache too, and every output token.
  const inputChars = requestChars(request);
  guardrails.reserve({
    ...worstCase(guardrails.estimateInputTokens(inputChars)),
    outputTokens: deps.provider.profile.defaultMaxOutputTokens,
  });
  const step = guardrails.state.steps;
  await audit.write({ type: "step_started", step });
  emit({
    type: "round_started",
    round: step,
    messages: request.messages.length,
    contextChars: request.system.length + request.messages.reduce((n, m) => n + m.content.length, 0),
    ...label,
  });

  const startedAt = now();
  const result = await deps.provider.generate({
    system: request.system,
    messages: request.messages,
    tools: request.tools,
    // A call may not outlive what the run has left on the wall clock.
    timeoutMs: Math.min(STEP_TIMEOUT_MS, guardrails.remainingMs()),
  });
  // The wall time of the call, minus what was spent waiting for the provider's
  // queue: the round's duration is the work, and the waiting is reported beside it.
  const durationMs = now() - startedAt - (result.backoff?.waitedMs ?? 0);
  guardrails.observeInput(inputChars, result.usage.inputTokens);
  const stepCost = guardrails.costOf(result.usage);
  request.account.record(result.usage, stepCost);

  // A breach is raised only after the round is traced and audited: the round
  // that ends a run is the one a person most needs to see.
  let breach: unknown;
  try {
    guardrails.recordUsage(result.usage);
    guardrails.recordToolCalls(result.toolCalls.length);
  } catch (error) {
    breach = error;
  }

  const pricing = deps.provider.profile.pricing ?? { inputPerMTokUsd: 0, outputPerMTokUsd: 0 };
  const run = guardrails.state;
  emit({
    type: "round_finished",
    round: step,
    durationMs,
    finishReason: result.finishReason,
    usage: result.usage,
    costUsd: stepCost,
    // Cache writes are input: `costInUsd + costOutUsd` is the round's cost.
    costInUsd: inputCostUsd(result.usage, pricing),
    costOutUsd: (result.usage.outputTokens / 1_000_000) * pricing.outputPerMTokUsd,
    text: result.text,
    toolCalls: result.toolCalls,
    ...(result.response ? { response: result.response } : {}),
    ...(result.backoff ? { backoff: result.backoff } : {}),
    run: {
      steps: run.steps,
      toolCalls: run.toolCalls,
      totalTokens: totalTokens(run.usage),
      costUsd: run.costUsd,
      webSearches: run.webSearches,
      remainingMs: guardrails.remainingMs(),
    },
    ...label,
  });

  await audit.write({
    type: "step_finished",
    step,
    finishReason: result.finishReason,
    usage: result.usage,
    costUsd: stepCost,
    toolCallNames: result.toolCalls.map((c) => c.name),
    durationMs,
    ...(result.backoff ? { backoffMs: result.backoff.waitedMs } : {}),
  });
  if (breach !== undefined) throw breach;

  request.messages.push({
    role: "assistant",
    content: result.text,
    ...(result.toolCalls.length > 0 ? { toolCalls: result.toolCalls } : {}),
    // Carried back on the next round: a reasoning model resumes from it.
    ...(result.reasoning?.length ? { reasoning: result.reasoning } : {}),
  });
  return result;
}

/**
 * One tool call, end to end: closed dispatch, schema validation, permission,
 * execution, spend, output cap. Returns what goes back to the model. Every
 * failure on the way is a sentence for the model, never an exception — except
 * the guardrails', which end the run.
 */
export class ToolRunner {
  readonly registry: ToolRegistry;
  #deps: LoopDeps;
  #permissions: PermissionPolicy;
  /** Names the model is told about when it calls one that does not exist. */
  #advertised: () => string[];

  constructor(options: {
    deps: LoopDeps;
    registry: ToolRegistry;
    permissions: PermissionPolicy;
    advertised?: () => string[];
  }) {
    this.#deps = options.deps;
    this.registry = options.registry;
    this.#permissions = options.permissions;
    this.#advertised = options.advertised ?? (() => options.registry.names);
  }

  async run(
    call: { id: string; name: string; args: unknown },
    account: TurnAccount,
    agent?: string,
  ): Promise<string> {
    const { name, args: rawArgs } = call;
    const { audit, emit, guardrails, now } = this.#deps;
    const label = agent === undefined ? {} : { agent };
    const round = guardrails.state.steps;
    const finish = (
      outcome: ToolOutcome["outcome"],
      result: string,
      extra: { durationMs?: number; details?: ToolDetails | undefined; costUsd?: number } = {},
    ) => {
      account.tools.push({ name, outcome });
      emit(toolFinished({ callId: call.id, name, agent }, outcome, result, extra));
      return result;
    };
    const started = (summary: string, access?: { risk: ToolRisk; paths: string[] }) =>
      emit({
        type: "tool_started",
        round,
        callId: call.id,
        name,
        args: rawArgs,
        summary,
        ...(access ? { risk: access.risk, paths: access.paths } : {}),
        ...label,
      });

    const handler = this.registry.get(name);
    // Closed dispatch: an unknown tool is reported back, never invoked.
    if (!handler) {
      started("");
      await audit.write({ type: "tool_rejected", toolName: name, reason: "schema_invalid" });
      return finish("unknown", `Error: there is no tool named "${name}". Available tools: ${this.#advertised().join(", ")}.`);
    }

    const args = handler.spec.schema.safeParse(rawArgs);
    if (!args.success) {
      started("");
      await audit.write({ type: "tool_rejected", toolName: name, reason: "schema_invalid" });
      return finish("rejected", `Error: invalid arguments for ${name}:\n${formatIssues(args.error)}`);
    }

    const access = handler.classify(args.data);
    started(access.summary, access);

    const decision = await this.#permissions.decide(name, access);
    if (access.risk !== "none") {
      emit({
        type: "tool_permission",
        callId: call.id,
        name,
        mode: this.#permissions.mode,
        allowed: decision.allowed,
        asked: decision.asked,
        ...(decision.message ? { message: decision.message } : {}),
        ...label,
      });
    }
    if (!decision.allowed) {
      await audit.write({ type: "tool_denied", toolName: name, risk: access.risk, asked: decision.asked });
      return finish("denied", decision.message ?? "Permission denied.");
    }

    const startedAt = now();
    let outcome: ToolExecution;
    try {
      outcome = await handler.execute(args.data, {
        account,
        remainingMs: () => guardrails.remainingMs(),
        budget: { webSearchesLeft: () => guardrails.webSearchesLeft, fits: (usage, extra) => guardrails.fits(usage, extra) },
      });
    } catch (error) {
      // A tool that throws is a bug in the tool, or a guardrail. The first is
      // an answer for the model; the second ends the run.
      if (isRunEnding(error)) throw error;
      outcome = { ok: false, content: `Error: ${name} failed: ${error instanceof Error ? error.message : String(error)}` };
    }

    let spent = 0;
    if (outcome.usage) {
      spent += guardrails.costOf(outcome.usage);
      account.charge(outcome.usage, guardrails.costOf(outcome.usage));
    }
    if (outcome.chargeUsd) {
      spent += outcome.chargeUsd;
      account.charge(ZERO_USAGE, outcome.chargeUsd);
    }

    const content = cap(outcome.content, guardrails.limits.maxToolResultChars);
    finish(outcome.ok ? "accepted" : "failed", content, { durationMs: now() - startedAt, details: outcome.details, costUsd: spent });
    await audit.write({ type: "tool_executed", toolName: name, ok: outcome.ok, resultChars: content.length });

    // Recorded last: a breach here must not lose the call's own accounting.
    if (outcome.webSearches) guardrails.recordSearches(outcome.webSearches);
    if (outcome.usage) guardrails.recordUsage(outcome.usage);
    if (outcome.chargeUsd) guardrails.recordCharge(outcome.chargeUsd);
    return content;
  }
}

const RUN_ENDING = new Set([
  "budget_exhausted",
  "step_limit_reached",
  "tool_call_limit_reached",
  "token_limit_reached",
  "deadline_exceeded",
]);

/** Characters a tool's schema adds to every request, measured once per spec. */
const specChars = new WeakMap<ToolSpec, number>();

function toolSpecChars(spec: ToolSpec): number {
  let chars = specChars.get(spec);
  if (chars === undefined) {
    let schema: string;
    try {
      // The input side, as the provider receives it: a schema that transforms has no output form.
      schema = JSON.stringify(z.toJSONSchema(spec.schema, { io: "input" }));
    } catch {
      // A schema with no JSON form: its description still travels, and 2,000 is generous.
      schema = " ".repeat(2_000);
    }
    chars = spec.name.length + spec.description.length + schema.length;
    specChars.set(spec, chars);
  }
  return chars;
}

/** Everything a round sends as input, in characters: system, messages with their tool calls, tool schemas. */
function requestChars(request: { system: string; messages: Message[]; tools: ToolSpec[] }): number {
  return request.system.length + JSON.stringify(request.messages).length + request.tools.reduce((n, t) => n + toolSpecChars(t), 0);
}

function isRunEnding(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && RUN_ENDING.has(String(error.code));
}

/** Compact, model-readable validation errors. Paths only, never the values. */
export function formatIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `- ${issue.path.join(".") || "(root)"}: ${issue.message}`).join("\n");
}
