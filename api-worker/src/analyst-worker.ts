import { join } from "node:path";

import type { AuditSink } from "./audit.js";
import { JsonlAuditSink } from "./audit.js";
import {
  AnalystProposalSchema,
  AnalystWorkerInputSchema,
  AnalystWorkerOutcomeSchema,
  AnalystWorkerResultSchema,
  type AnalystWorkerOutcome,
} from "./analyst-contract.js";
import type { AuditEvent, WorkerErrorCode } from "./contract.js";
import { WorkerFault, normalizeFault } from "./errors.js";
import { RunGuard } from "./guardrails.js";
import {
  API_KEY_ENV_BY_PROVIDER,
  ModelProfileSchema,
  assertStructuredOutputCapability,
  type ModelProfile,
} from "./model-profile.js";
import { AiSdkAnalystProvider } from "./providers/analyst-ai-sdk.js";
import { MockAnalystProvider } from "./providers/analyst-mock.js";
import type {
  AnalystProviderAdapter,
  AnalystProviderContext,
} from "./providers/analyst-provider.js";
import { ANALYST_SYSTEM_PROMPT, buildAnalystPrompt } from "./role/analyst.js";
import { ExclusiveRunLock } from "./run-lock.js";

export type AnalystWorkerOptions = {
  runtimeDir: string;
  liveEnabled?: boolean;
  env?: NodeJS.ProcessEnv;
  audit?: AuditSink;
  adapter?: AnalystProviderAdapter;
  now?: () => number;
};

export class AnalystApiWorker {
  private readonly audit: AuditSink;
  private readonly now: () => number;

  constructor(
    private readonly rawProfile: unknown,
    private readonly options: AnalystWorkerOptions,
  ) {
    this.audit =
      options.audit ??
      new JsonlAuditSink(join(options.runtimeDir, "analyst-runs.jsonl"));
    this.now = options.now ?? Date.now;
  }

  async run(rawInput: unknown): Promise<AnalystWorkerOutcome> {
    const startedAt = this.now();
    let runId: string | undefined;
    let profile: ModelProfile | undefined;
    let guard: RunGuard | undefined;
    let lock: ExclusiveRunLock | undefined;

    try {
      const inputResult = AnalystWorkerInputSchema.safeParse(rawInput);
      if (!inputResult.success) throw new WorkerFault("INPUT_VALIDATION");
      const input = inputResult.data;
      runId = input.runId;

      const profileResult = ModelProfileSchema.safeParse(this.rawProfile);
      if (!profileResult.success) throw new WorkerFault("PROFILE_VALIDATION");
      profile = profileResult.data;
      try {
        assertStructuredOutputCapability(profile);
      } catch (error) {
        throw new WorkerFault("CAPABILITY_UNSUPPORTED", { cause: error });
      }
      if (profile.provider !== "mock" && !this.options.liveEnabled) {
        throw new WorkerFault("LIVE_NOT_ENABLED");
      }
      assertLiveBudget(profile, input.limits.maxCostUsd);

      const prompt = buildAnalystPrompt(input);
      guard = new RunGuard(input.limits, profile, this.now, false);
      guard.assertInitialInput(`${ANALYST_SYSTEM_PROMPT}\n${prompt}`);
      lock = new ExclusiveRunLock(
        join(this.options.runtimeDir, "analyst.lock"),
      );
      await lock.acquire(input.runId);

      await this.audit.write({
        contractVersion: "1",
        event: "run_started",
        timestamp: new Date(this.now()).toISOString(),
        runId,
        role: "analyst",
        provider: profile.provider,
        model: profile.model,
      });

      const adapter = this.createAdapter(profile);
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(new Error("worker timeout")),
        input.limits.timeoutMs,
      );
      let execution;
      try {
        const context: AnalystProviderContext = {
          input,
          profile,
          systemPrompt: ANALYST_SYSTEM_PROMPT,
          prompt,
          guard,
          signal: controller.signal,
          recordRequestStarted: async (reservation) => {
            await this.audit.write({
              contractVersion: "1",
              event: "provider_request",
              phase: "started",
              timestamp: new Date(this.now()).toISOString(),
              runId,
              role: "analyst",
              provider: profile!.provider,
              model: profile!.model,
              step: reservation.step,
            });
          },
          recordRequestFailed: async (reservation, failureReason) => {
            await this.audit.write({
              contractVersion: "1",
              event: "provider_request",
              phase: "failed",
              timestamp: new Date(this.now()).toISOString(),
              runId,
              role: "analyst",
              provider: profile!.provider,
              model: profile!.model,
              step: reservation.step,
              latencyMs: elapsed(this.now, reservation.startedAtMs),
              failureReason,
            });
          },
          recordStep: async ({
            reservation,
            usage,
            finishReason,
            responseId,
          }) => {
            const recorded = guard!.recordProviderStep(reservation, usage);
            await this.audit.write({
              contractVersion: "1",
              event: "provider_step",
              timestamp: new Date(this.now()).toISOString(),
              runId,
              role: "analyst",
              provider: profile!.provider,
              model: profile!.model,
              step: recorded.step,
              latencyMs: recorded.latencyMs,
              usage: recorded.usage,
              cost: recorded.cost,
              responseId,
              stopReason: sanitizeStopReason(finishReason),
            });
          },
        };
        execution = await adapter.run(context);
      } finally {
        clearTimeout(timeout);
      }

      const proposal = AnalystProposalSchema.parse(execution.output);
      if (
        proposal.sourceId !== input.position.sourceId ||
        proposal.url !== input.position.url
      ) {
        throw new WorkerFault("OUTPUT_VALIDATION");
      }
      guard.assertResult(JSON.stringify(proposal));
      const metrics = guard.metrics;
      const result = AnalystWorkerResultSchema.parse({
        contractVersion: "1",
        runId,
        role: "analyst",
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
      });
      await this.audit.write({
        contractVersion: "1",
        event: "run_completed",
        timestamp: new Date(this.now()).toISOString(),
        runId,
        role: "analyst",
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
      });
      return AnalystWorkerOutcomeSchema.parse({ ok: true, result });
    } catch (error) {
      const fault = knownFault(error);
      const partial = guard?.metrics;
      await this.writeFailureAudit({
        contractVersion: "1",
        event: "run_failed",
        timestamp: new Date(this.now()).toISOString(),
        runId,
        role: "analyst",
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
      });
      return AnalystWorkerOutcomeSchema.parse({
        ok: false,
        error: {
          contractVersion: "1",
          runId,
          role: "analyst",
          code: fault.code,
          message: analystMessage(fault.code),
          retryable: fault.retryable,
          limit: fault.limit,
          usage: partial?.usage,
          cost: partial?.cost,
        },
      });
    } finally {
      await lock?.release();
    }
  }

  private createAdapter(profile: ModelProfile): AnalystProviderAdapter {
    if (this.options.adapter) {
      if (profile.provider !== "mock") throw new WorkerFault("INTERNAL_ERROR");
      return this.options.adapter;
    }
    if (profile.provider === "mock") return new MockAnalystProvider();
    if (!this.options.liveEnabled) throw new WorkerFault("LIVE_NOT_ENABLED");
    const envName = API_KEY_ENV_BY_PROVIDER[profile.provider];
    const apiKey = (this.options.env ?? process.env)[envName];
    if (!apiKey) throw new WorkerFault("API_KEY_MISSING");
    return new AiSdkAnalystProvider(apiKey);
  }

  private async writeFailureAudit(event: AuditEvent): Promise<void> {
    try {
      await this.audit.write(event);
    } catch {
      // Public failures remain deterministic if the local audit sink fails.
    }
  }
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

function sanitizeStopReason(raw: string): string {
  return (
    raw
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "_")
      .slice(0, 80) || "unknown"
  );
}

function analystMessage(code: WorkerErrorCode): string {
  const messages: Record<WorkerErrorCode, string> = {
    INPUT_VALIDATION: "The Analyst worker input is invalid.",
    PROFILE_VALIDATION: "The model profile is invalid.",
    CAPABILITY_UNSUPPORTED:
      "The selected model profile lacks structured output support.",
    LIVE_NOT_ENABLED: "Live provider access requires the explicit live flag.",
    LIVE_BUDGET_REQUIRED:
      "Live provider access requires explicit pricing and a positive budget.",
    API_KEY_MISSING: "The selected provider API key is missing.",
    CONCURRENT_RUN: "Another Analyst API run owns the worker lock.",
    INPUT_LIMIT: "The provider request exceeds the input limit.",
    OUTPUT_LIMIT: "The provider output exceeds an output limit.",
    STEP_LIMIT: "The Analyst run reached its provider step limit.",
    TOOL_CALL_LIMIT: "The Analyst run reached its tool-call limit.",
    BUDGET_EXCEEDED: "The Analyst run exceeded its USD budget.",
    TIMEOUT: "The Analyst run exceeded its time limit.",
    TOOL_ERROR: "An authorized Analyst tool failed.",
    PROVIDER_ERROR: "The model provider failed the Analyst run.",
    OUTPUT_VALIDATION: "The provider returned an invalid Analyst proposal.",
    INTERNAL_ERROR: "The Analyst worker failed safely.",
  };
  return messages[code];
}

function elapsed(now: () => number, startedAt: number): number {
  return Math.max(0, Math.round(now() - startedAt));
}
