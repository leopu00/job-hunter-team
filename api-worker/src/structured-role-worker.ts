import { join } from "node:path";

import { Output, generateText, stepCountIs } from "ai";
import { z } from "zod";

import type { AgentRole } from "./agent-role.js";
import type { AuditSink } from "./audit.js";
import { JsonlAuditSink } from "./audit.js";
import {
  CostSchema,
  RunLimitsSchema,
  UsageSchema,
  WorkerErrorCodeSchema,
  type AuditEvent,
  type RunLimits,
  type Usage,
  type WorkerErrorCode,
} from "./contract.js";
import { WorkerFault, normalizeFault } from "./errors.js";
import { RunGuard, type StepReservation } from "./guardrails.js";
import {
  API_KEY_ENV_BY_PROVIDER,
  ModelProfileSchema,
  assertStructuredOutputCapability,
  type ModelProfile,
} from "./model-profile.js";
import {
  createAiSdkModel,
  normalizeAiSdkUsage,
} from "./providers/ai-sdk-runtime.js";
import { providerDiagnostic } from "./providers/ai-sdk.js";
import type { ProviderStepRecord } from "./providers/provider.js";
import { ExclusiveRunLock } from "./run-lock.js";

export type StructuredRoleInput = {
  contractVersion: "1";
  runId: string;
  role: AgentRole;
  limits: RunLimits;
};

export type StructuredRoleProposal = {
  disposition: "proposed";
  persistence: "none";
};

export type StructuredRoleSpec<
  I extends StructuredRoleInput,
  O extends StructuredRoleProposal,
> = {
  role: I["role"];
  outputName: string;
  outputDescription: string;
  inputSchema: z.ZodType<I>;
  outputSchema: z.ZodType<O>;
  providerOutputSchema?: z.ZodType<unknown>;
  parseProviderOutput?: (raw: unknown) => O;
  systemPrompt: string;
  buildPrompt(input: I): string;
  buildMockOutput(input: I): O;
  validateOutput?(input: I, output: O): void;
};

export type StructuredRoleResult<O extends StructuredRoleProposal> = {
  contractVersion: "1";
  runId: string;
  role: AgentRole;
  status: "completed";
  disposition: "proposal_only";
  persistence: "none";
  provider: "mock" | "anthropic" | "openai" | "kimi";
  model: string;
  proposal: O;
  usage: Usage;
  cost: z.infer<typeof CostSchema>;
  metrics: {
    latencyMs: number;
    steps: number;
    providerRequests: number;
    toolCalls: number;
    webSearchCalls: number;
  };
};

export type StructuredRoleOutcome<O extends StructuredRoleProposal> =
  | { ok: true; result: StructuredRoleResult<O> }
  | {
      ok: false;
      error: {
        contractVersion: "1";
        runId?: string;
        role: AgentRole;
        code: WorkerErrorCode;
        message: string;
        retryable: boolean;
        limit?:
          | "input_tokens_per_step"
          | "output_tokens_per_step"
          | "total_output_tokens"
          | "result_bytes"
          | "steps"
          | "tool_calls"
          | "timeout_ms"
          | "cost_usd"
          | "concurrency";
      };
    };

export type StructuredRoleProviderContext<I extends StructuredRoleInput> = {
  input: I;
  profile: ModelProfile;
  systemPrompt: string;
  prompt: string;
  guard: RunGuard;
  signal: AbortSignal;
  recordRequestStarted(reservation: StepReservation): Promise<void>;
  recordRequestFailed(
    reservation: StepReservation,
    failureReason: string,
  ): Promise<void>;
  recordStep(record: ProviderStepRecord): Promise<void>;
};

type AuditEventPayload = AuditEvent extends infer Event
  ? Event extends AuditEvent
    ? Omit<Event, "contractVersion" | "timestamp" | "role">
    : never
  : never;

export interface StructuredRoleProviderAdapter<
  I extends StructuredRoleInput,
  O extends StructuredRoleProposal,
> {
  run(
    context: StructuredRoleProviderContext<I>,
  ): Promise<{ output: O; rawStopReason: string }>;
}

export type StructuredRoleWorkerOptions<
  I extends StructuredRoleInput,
  O extends StructuredRoleProposal,
> = {
  runtimeDir: string;
  liveEnabled?: boolean;
  env?: NodeJS.ProcessEnv;
  audit?: AuditSink;
  adapter?: StructuredRoleProviderAdapter<I, O>;
  now?: () => number;
};

export class StructuredRoleApiWorker<
  I extends StructuredRoleInput,
  O extends StructuredRoleProposal,
> {
  private readonly audit: AuditSink;
  private readonly now: () => number;

  constructor(
    private readonly spec: StructuredRoleSpec<I, O>,
    private readonly rawProfile: unknown,
    private readonly options: StructuredRoleWorkerOptions<I, O>,
  ) {
    this.audit =
      options.audit ??
      new JsonlAuditSink(join(options.runtimeDir, `${spec.role}-runs.jsonl`));
    this.now = options.now ?? Date.now;
  }

  async run(rawInput: unknown): Promise<StructuredRoleOutcome<O>> {
    const startedAt = this.now();
    let runId: string | undefined;
    let profile: ModelProfile | undefined;
    let guard: RunGuard | undefined;
    let lock: ExclusiveRunLock | undefined;
    try {
      const parsedInput = this.spec.inputSchema.safeParse(rawInput);
      if (!parsedInput.success) throw new WorkerFault("INPUT_VALIDATION");
      const input = parsedInput.data;
      runId = input.runId;
      const parsedProfile = ModelProfileSchema.safeParse(this.rawProfile);
      if (!parsedProfile.success) throw new WorkerFault("PROFILE_VALIDATION");
      profile = parsedProfile.data;
      try {
        assertStructuredOutputCapability(profile);
      } catch (error) {
        throw new WorkerFault("CAPABILITY_UNSUPPORTED", { cause: error });
      }
      if (profile.provider !== "mock" && !this.options.liveEnabled) {
        throw new WorkerFault("LIVE_NOT_ENABLED");
      }
      assertLiveBudget(profile, input.limits.maxCostUsd);

      const prompt = this.spec.buildPrompt(input);
      guard = new RunGuard(input.limits, profile, this.now, false);
      guard.assertInitialInput(`${this.spec.systemPrompt}\n${prompt}`);
      lock = new ExclusiveRunLock(
        join(this.options.runtimeDir, `${this.spec.role}.lock`),
      );
      await lock.acquire(input.runId);
      await this.audit.write(
        roleEvent(this.spec.role, this.now(), {
          event: "run_started",
          runId,
          provider: profile.provider,
          model: profile.model,
        }),
      );

      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(new Error("worker timeout")),
        input.limits.timeoutMs,
      );
      let execution: { output: O; rawStopReason: string };
      try {
        const context: StructuredRoleProviderContext<I> = {
          input,
          profile,
          systemPrompt: this.spec.systemPrompt,
          prompt,
          guard,
          signal: controller.signal,
          recordRequestStarted: async (reservation) => {
            await this.audit.write(
              roleEvent(this.spec.role, this.now(), {
                event: "provider_request",
                phase: "started",
                runId,
                provider: profile!.provider,
                model: profile!.model,
                step: reservation.step,
              }),
            );
          },
          recordRequestFailed: async (reservation, failureReason) => {
            await this.audit.write(
              roleEvent(this.spec.role, this.now(), {
                event: "provider_request",
                phase: "failed",
                runId,
                provider: profile!.provider,
                model: profile!.model,
                step: reservation.step,
                latencyMs: elapsed(this.now, reservation.startedAtMs),
                failureReason,
              }),
            );
          },
          recordStep: async ({
            reservation,
            usage,
            finishReason,
            responseId,
          }) => {
            const recorded = guard!.recordProviderStep(reservation, usage);
            await this.audit.write(
              roleEvent(this.spec.role, this.now(), {
                event: "provider_step",
                runId,
                provider: profile!.provider,
                model: profile!.model,
                step: recorded.step,
                latencyMs: recorded.latencyMs,
                usage: recorded.usage,
                cost: recorded.cost,
                responseId,
                stopReason: sanitizeStopReason(finishReason),
              }),
            );
          },
        };
        execution = await this.createAdapter(profile).run(context);
      } finally {
        clearTimeout(timeout);
      }

      const proposal = this.spec.outputSchema.parse(execution.output);
      this.spec.validateOutput?.(input, proposal);
      guard.assertResult(JSON.stringify(proposal));
      const metrics = guard.metrics;
      const result = makeResultSchema(
        this.spec.role,
        this.spec.outputSchema,
      ).parse({
        contractVersion: "1",
        runId,
        role: this.spec.role,
        status: "completed",
        disposition: "proposal_only",
        persistence: "none",
        provider: profile.provider,
        model: profile.model,
        proposal,
        usage: metrics.usage,
        cost: metrics.cost,
        metrics: {
          latencyMs: elapsed(this.now, startedAt),
          steps: metrics.steps,
          providerRequests: metrics.providerRequests,
          toolCalls: metrics.toolCalls,
          webSearchCalls: metrics.webSearchCalls,
        },
      }) as StructuredRoleResult<O>;
      await this.audit.write(
        roleEvent(this.spec.role, this.now(), {
          event: "run_completed",
          runId,
          provider: profile.provider,
          model: profile.model,
          latencyMs: result.metrics.latencyMs,
          usage: result.usage,
          cost: result.cost,
          toolCalls: result.metrics.toolCalls,
          providerRequests: result.metrics.providerRequests,
          webSearchCalls: result.metrics.webSearchCalls,
          steps: result.metrics.steps,
          stopReason: "completed",
          proposalCount: 1,
        }),
      );
      return { ok: true, result };
    } catch (error) {
      writeStructuredRoleProviderDiagnostic(this.spec.role, error);
      const fault = knownFault(error);
      const partial = guard?.metrics;
      await this.writeFailureAudit(
        roleEvent(this.spec.role, this.now(), {
          event: "run_failed",
          runId,
          provider: profile?.provider,
          model: profile?.model,
          latencyMs: elapsed(this.now, startedAt),
          errorCode: fault.code,
          retryable: fault.retryable,
          limit: fault.limit,
          usage: partial?.usage,
          cost: partial?.cost,
          providerRequests: partial?.providerRequests,
          pricedProviderRequests: partial?.pricedProviderRequests,
          toolCalls: partial?.toolCalls,
          webSearchCalls: partial?.webSearchCalls,
        }),
      );
      return {
        ok: false,
        error: makeErrorSchema(this.spec.role).parse({
          contractVersion: "1",
          runId,
          role: this.spec.role,
          code: fault.code,
          message: publicMessage(this.spec.role, fault.code),
          retryable: fault.retryable,
          limit: fault.limit,
        }),
      };
    } finally {
      await lock?.release();
    }
  }

  private createAdapter(
    profile: ModelProfile,
  ): StructuredRoleProviderAdapter<I, O> {
    if (this.options.adapter) {
      if (profile.provider !== "mock") throw new WorkerFault("INTERNAL_ERROR");
      return this.options.adapter;
    }
    if (profile.provider === "mock")
      return new MockStructuredRoleProvider(this.spec);
    if (!this.options.liveEnabled) throw new WorkerFault("LIVE_NOT_ENABLED");
    const envName = API_KEY_ENV_BY_PROVIDER[profile.provider];
    const apiKey = (this.options.env ?? process.env)[envName];
    if (!apiKey) throw new WorkerFault("API_KEY_MISSING");
    return new AiSdkStructuredRoleProvider(this.spec, apiKey);
  }

  private async writeFailureAudit(event: AuditEvent): Promise<void> {
    try {
      await this.audit.write(event);
    } catch {
      // Keep the public role boundary sanitized when local audit storage fails.
    }
  }
}

class MockStructuredRoleProvider<
  I extends StructuredRoleInput,
  O extends StructuredRoleProposal,
> implements StructuredRoleProviderAdapter<I, O> {
  constructor(private readonly spec: StructuredRoleSpec<I, O>) {}

  async run(context: StructuredRoleProviderContext<I>) {
    if (context.signal.aborted) throw timeoutFault();
    const reservation = context.guard.beforeProviderStep(
      `${context.systemPrompt}\n${context.prompt}`,
    );
    await context.recordRequestStarted(reservation);
    const output = this.spec.outputSchema.parse(
      this.spec.buildMockOutput(context.input),
    );
    await context.recordStep({
      reservation,
      usage: { inputTokens: 360, outputTokens: 220, totalTokens: 580 },
      finishReason: "stop",
    });
    return { output, rawStopReason: "stop" };
  }
}

class AiSdkStructuredRoleProvider<
  I extends StructuredRoleInput,
  O extends StructuredRoleProposal,
> implements StructuredRoleProviderAdapter<I, O> {
  constructor(
    private readonly spec: StructuredRoleSpec<I, O>,
    private readonly apiKey: string,
  ) {}

  async run(context: StructuredRoleProviderContext<I>) {
    const reservations = new Map<number, StepReservation>();
    const finished = new Set<number>();
    try {
      const result = await generateText({
        model: createAiSdkModel(context.profile, this.apiKey),
        system: context.systemPrompt,
        prompt: context.prompt,
        output: Output.object({
          name: this.spec.outputName,
          description: this.spec.outputDescription,
          schema: this.spec.providerOutputSchema ?? this.spec.outputSchema,
        }),
        stopWhen: stepCountIs(context.input.limits.maxSteps),
        maxOutputTokens: context.input.limits.maxOutputTokensPerStep,
        maxRetries: 0,
        abortSignal: context.signal,
        prepareStep: async ({ messages, stepNumber }) => {
          const reservation = context.guard.beforeProviderStep(
            JSON.stringify({ system: context.systemPrompt, messages }),
          );
          reservations.set(stepNumber, reservation);
          await context.recordRequestStarted(reservation);
          return {};
        },
        onStepFinish: async ({ stepNumber, usage, finishReason, response }) => {
          const reservation = reservations.get(stepNumber);
          if (!reservation) throw new WorkerFault("INTERNAL_ERROR");
          finished.add(stepNumber);
          await context.recordStep({
            reservation,
            usage: normalizeAiSdkUsage(usage),
            finishReason,
            responseId: response.id,
          });
        },
      });
      return {
        output: this.spec.parseProviderOutput
          ? this.spec.parseProviderOutput(result.output)
          : this.spec.outputSchema.parse(result.output),
        rawStopReason: result.finishReason,
      };
    } catch (error) {
      await Promise.all(
        [...reservations.entries()]
          .filter(([step]) => !finished.has(step))
          .map(([, reservation]) =>
            context.recordRequestFailed(reservation, "provider_error"),
          ),
      );
      if (error instanceof WorkerFault) throw error;
      if (context.signal.aborted) throw timeoutFault(error);
      writeStructuredRoleProviderDiagnostic(this.spec.role, error);
      throw new WorkerFault("PROVIDER_ERROR", {
        retryable: true,
        cause: error,
      });
    }
  }
}

export function writeStructuredRoleProviderDiagnostic(
  role: AgentRole,
  error: unknown,
): void {
  if (process.env.JHT_API_PROVIDER_DEBUG !== "1") return;
  process.stderr.write(
    `[api-provider-debug] ${JSON.stringify({ role, ...providerDiagnostic(error) })}\n`,
  );
}

function makeResultSchema<O extends StructuredRoleProposal>(
  role: AgentRole,
  outputSchema: z.ZodType<O>,
) {
  return z.strictObject({
    contractVersion: z.literal("1"),
    runId: z.string().uuid(),
    role: z.literal(role),
    status: z.literal("completed"),
    disposition: z.literal("proposal_only"),
    persistence: z.literal("none"),
    provider: z.enum(["mock", "anthropic", "openai", "kimi"]),
    model: z.string().trim().min(1).max(240),
    proposal: outputSchema,
    usage: UsageSchema,
    cost: CostSchema,
    metrics: z.strictObject({
      latencyMs: z.number().int().nonnegative(),
      steps: z.number().int().nonnegative(),
      providerRequests: z.number().int().nonnegative(),
      toolCalls: z.number().int().nonnegative(),
      webSearchCalls: z.number().int().nonnegative(),
    }),
  });
}

function makeErrorSchema(role: AgentRole) {
  return z.strictObject({
    contractVersion: z.literal("1"),
    runId: z.string().uuid().optional(),
    role: z.literal(role),
    code: WorkerErrorCodeSchema,
    message: z.string().trim().min(1).max(240),
    retryable: z.boolean(),
    limit: z
      .enum([
        "input_tokens_per_step",
        "output_tokens_per_step",
        "total_output_tokens",
        "result_bytes",
        "steps",
        "tool_calls",
        "timeout_ms",
        "cost_usd",
        "concurrency",
      ])
      .optional(),
  });
}

function roleEvent(
  role: AgentRole,
  now: number,
  event: AuditEventPayload,
): AuditEvent {
  return {
    contractVersion: "1",
    timestamp: new Date(now).toISOString(),
    role,
    ...event,
  } as AuditEvent;
}

function assertLiveBudget(profile: ModelProfile, maxCostUsd: number): void {
  if (profile.provider === "mock") return;
  if (
    maxCostUsd <= 0 ||
    !profile.pricing ||
    profile.pricing.inputUsdPerMillionTokens +
      profile.pricing.outputUsdPerMillionTokens <=
      0
  ) {
    throw new WorkerFault("LIVE_BUDGET_REQUIRED", { limit: "cost_usd" });
  }
}

function knownFault(error: unknown): WorkerFault {
  if (error instanceof WorkerFault) return error;
  if (error instanceof Error && error.name === "ZodError") {
    return new WorkerFault("OUTPUT_VALIDATION", { cause: error });
  }
  return normalizeFault(error);
}

function publicMessage(role: AgentRole, code: WorkerErrorCode): string {
  const label = role[0]!.toUpperCase() + role.slice(1);
  const messages: Record<WorkerErrorCode, string> = {
    INPUT_VALIDATION: `The ${label} worker input is invalid.`,
    PROFILE_VALIDATION: "The model profile is invalid.",
    CAPABILITY_UNSUPPORTED: "The model lacks structured output support.",
    LIVE_NOT_ENABLED: "Live provider access requires the explicit live flag.",
    LIVE_BUDGET_REQUIRED:
      "Live provider access requires explicit pricing and a positive budget.",
    API_KEY_MISSING: "The selected provider API key is missing.",
    CONCURRENT_RUN: `Another ${label} API run owns the worker lock.`,
    INPUT_LIMIT: "The provider request exceeds the input limit.",
    OUTPUT_LIMIT: "The provider output exceeds an output limit.",
    STEP_LIMIT: `The ${label} run reached its provider step limit.`,
    TOOL_CALL_LIMIT: `The ${label} run reached its tool-call limit.`,
    BUDGET_EXCEEDED: `The ${label} run exceeded its USD budget.`,
    TIMEOUT: `The ${label} run exceeded its time limit.`,
    TOOL_ERROR: `An authorized ${label} tool failed.`,
    PROVIDER_ERROR: `The model provider failed the ${label} run.`,
    OUTPUT_VALIDATION: `The provider returned an invalid ${label} proposal.`,
    INTERNAL_ERROR: `The ${label} worker failed safely.`,
  };
  return messages[code];
}

function sanitizeStopReason(raw: string): string {
  return (
    raw
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "_")
      .slice(0, 80) || "unknown"
  );
}

function timeoutFault(cause?: unknown): WorkerFault {
  return new WorkerFault("TIMEOUT", {
    retryable: true,
    limit: "timeout_ms",
    cause,
  });
}

function elapsed(now: () => number, startedAt: number): number {
  return Math.max(0, Math.round(now() - startedAt));
}
