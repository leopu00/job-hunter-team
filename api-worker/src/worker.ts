import { join } from "node:path";

import type { AuditSink } from "./audit.js";
import { JsonlAuditSink } from "./audit.js";
import {
  ScoutProposalBatchSchema,
  ScoutWorkerInputSchema,
  ScoutWorkerOutcomeSchema,
  ScoutWorkerResultSchema,
  type AuditEvent,
  type ScoutWorkerOutcome,
  type StopReason,
} from "./contract.js";
import { WorkerFault, normalizeFault } from "./errors.js";
import { RunGuard } from "./guardrails.js";
import {
  API_KEY_ENV_BY_PROVIDER,
  ModelProfileSchema,
  assertScoutCapabilities,
  assertWebSearchCapability,
  type ModelProfile,
} from "./model-profile.js";
import { AiSdkScoutProvider } from "./providers/ai-sdk.js";
import { MockScoutProvider } from "./providers/mock.js";
import type {
  ProviderExecutionContext,
  ScoutProviderAdapter,
} from "./providers/provider.js";
import {
  SCOUT_SYSTEM_PROMPT,
  buildScoutPrompt,
  buildScoutSystemPrompt,
} from "./role/scout.js";
import { ExclusiveRunLock } from "./run-lock.js";
import { GuardedScoutTools, type ScoutJobSource } from "./tools.js";
import type { ScoutWebJobReader } from "./web-job-reader.js";

export type ScoutWorkerOptions = {
  runtimeDir: string;
  source: ScoutJobSource;
  webReader?: ScoutWebJobReader;
  liveEnabled?: boolean;
  env?: NodeJS.ProcessEnv;
  audit?: AuditSink;
  adapter?: ScoutProviderAdapter;
  now?: () => number;
};

export class ScoutApiWorker {
  private readonly audit: AuditSink;
  private readonly now: () => number;

  constructor(
    private readonly rawProfile: unknown,
    private readonly options: ScoutWorkerOptions,
  ) {
    this.audit =
      options.audit ??
      new JsonlAuditSink(join(options.runtimeDir, "scout-runs.jsonl"));
    this.now = options.now ?? Date.now;
  }

  async run(rawInput: unknown): Promise<ScoutWorkerOutcome> {
    const startedAt = this.now();
    let runId: string | undefined;
    let profile: ModelProfile | undefined;
    let lock: ExclusiveRunLock | undefined;
    let guard: RunGuard | undefined;

    try {
      const inputResult = ScoutWorkerInputSchema.safeParse(rawInput);
      if (!inputResult.success) throw new WorkerFault("INPUT_VALIDATION");
      const input = inputResult.data;
      runId = input.runId;

      const profileResult = ModelProfileSchema.safeParse(this.rawProfile);
      if (!profileResult.success) throw new WorkerFault("PROFILE_VALIDATION");
      profile = profileResult.data;
      assertCapabilities(profile);
      if (this.options.webReader) assertWebCapabilities(profile);
      if (profile.provider !== "mock" && !this.options.liveEnabled) {
        throw new WorkerFault("LIVE_NOT_ENABLED");
      }
      assertLiveBudget(profile, input.limits.maxCostUsd);

      const systemPrompt = this.options.webReader
        ? buildScoutSystemPrompt("web")
        : SCOUT_SYSTEM_PROMPT;
      const prompt = buildScoutPrompt(
        input,
        this.options.webReader ? "web" : "catalog",
      );
      guard = new RunGuard(input.limits, profile, this.now);
      guard.assertInitialInput(`${systemPrompt}\n${prompt}`);

      lock = new ExclusiveRunLock(join(this.options.runtimeDir, "scout.lock"));
      await lock.acquire(input.runId);

      const adapter = this.createAdapter(profile);
      const tools = new GuardedScoutTools(
        input,
        this.options.source,
        guard,
        this.audit,
        this.now,
        this.options.webReader,
      );
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(new Error("worker timeout")),
        input.limits.timeoutMs,
      );

      await this.audit.write({
        contractVersion: "1",
        event: "run_started",
        timestamp: new Date(this.now()).toISOString(),
        runId: input.runId,
        provider: profile.provider,
        model: profile.model,
      });

      let execution;
      try {
        const context: ProviderExecutionContext = {
          input,
          profile,
          systemPrompt,
          prompt,
          tools,
          guard,
          discoveryMode: this.options.webReader ? "web" : "catalog",
          signal: controller.signal,
          recordRequestStarted: async (reservation) => {
            await this.audit.write({
              contractVersion: "1",
              event: "provider_request",
              phase: "started",
              timestamp: new Date(this.now()).toISOString(),
              runId: input.runId,
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
              runId: input.runId,
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
            webSearchCalls = 0,
            responseId,
          }) => {
            const recorded = guard!.recordProviderStep(reservation, usage);
            await this.audit.write({
              contractVersion: "1",
              event: "provider_step",
              timestamp: new Date(this.now()).toISOString(),
              runId: input.runId,
              provider: profile!.provider,
              model: profile!.model,
              step: recorded.step,
              latencyMs: recorded.latencyMs,
              usage: recorded.usage,
              cost: recorded.cost,
              webSearchCalls,
              webSearchCostUsd:
                webSearchCalls * (profile!.pricing?.webSearchUsdPerCall ?? 0),
              responseId,
              stopReason: sanitizeStopReason(finishReason),
            });
          },
        };
        execution = await adapter.run(context);
      } finally {
        clearTimeout(timeout);
      }

      const output = ScoutProposalBatchSchema.parse(execution.output);
      if (output.proposals.length > input.search.maxCandidates) {
        throw new WorkerFault("OUTPUT_VALIDATION");
      }
      tools.assertProposalsCameFromTools(output.proposals);
      guard.assertResult(JSON.stringify(output));

      const metrics = guard.metrics;
      const stopReason = normalizeStopReason(
        execution.rawStopReason,
        output.proposals.length,
      );
      const result = ScoutWorkerResultSchema.parse({
        contractVersion: "1",
        runId: input.runId,
        role: "scout",
        status: "completed",
        disposition: "proposal_only",
        persistence: "none",
        provider: profile.provider,
        model: profile.model,
        stopReason,
        proposals: output.proposals,
        exhausted: output.exhausted,
        notes: output.notes,
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
        runId: input.runId,
        provider: profile.provider,
        model: profile.model,
        latencyMs: result.metrics.latencyMs,
        usage: result.usage,
        cost: result.cost,
        toolCalls: result.metrics.toolCalls,
        providerRequests: result.metrics.providerRequests,
        webSearchCalls: result.metrics.webSearchCalls,
        steps: result.metrics.steps,
        stopReason: result.stopReason,
        proposalCount: result.proposals.length,
      });

      return ScoutWorkerOutcomeSchema.parse({ ok: true, result });
    } catch (error) {
      const fault = mapKnownFault(error);
      const contractError = fault.toContract(runId);
      const partialMetrics = guard?.metrics;
      await this.writeFailureAudit({
        contractVersion: "1",
        event: "run_failed",
        timestamp: new Date(this.now()).toISOString(),
        runId,
        provider: profile?.provider,
        model: profile?.model,
        latencyMs: elapsed(this.now, startedAt),
        errorCode: contractError.code,
        retryable: contractError.retryable,
        limit: contractError.limit,
        usage: partialMetrics?.usage,
        cost: partialMetrics?.cost,
        providerRequests: partialMetrics?.providerRequests,
        pricedProviderRequests: partialMetrics?.pricedProviderRequests,
        toolCalls: partialMetrics?.toolCalls,
        webSearchCalls: partialMetrics?.webSearchCalls,
      });
      return ScoutWorkerOutcomeSchema.parse({
        ok: false,
        error: contractError,
      });
    } finally {
      await lock?.release();
    }
  }

  private createAdapter(profile: ModelProfile): ScoutProviderAdapter {
    if (this.options.adapter) {
      if (profile.provider !== "mock") {
        throw new WorkerFault("INTERNAL_ERROR");
      }
      return this.options.adapter;
    }
    if (profile.provider === "mock") return new MockScoutProvider();
    if (!this.options.liveEnabled) throw new WorkerFault("LIVE_NOT_ENABLED");

    const envName = API_KEY_ENV_BY_PROVIDER[profile.provider];
    const apiKey = (this.options.env ?? process.env)[envName];
    if (!apiKey) throw new WorkerFault("API_KEY_MISSING");
    return new AiSdkScoutProvider(apiKey);
  }

  private async writeFailureAudit(event: AuditEvent): Promise<void> {
    try {
      await this.audit.write(event);
    } catch {
      // The public outcome must remain sanitized and deterministic even when
      // the local audit destination itself is unavailable.
    }
  }
}

function assertCapabilities(profile: ModelProfile): void {
  try {
    assertScoutCapabilities(profile);
  } catch (error) {
    throw new WorkerFault("CAPABILITY_UNSUPPORTED", { cause: error });
  }
}

function assertWebCapabilities(profile: ModelProfile): void {
  try {
    assertWebSearchCapability(profile);
  } catch (error) {
    throw new WorkerFault("CAPABILITY_UNSUPPORTED", { cause: error });
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

function normalizeStopReason(raw: string, proposalCount: number): StopReason {
  if (proposalCount === 0) return "no_candidates";
  return raw === "stop" || raw === "completed" ? "completed" : "provider_stop";
}

function sanitizeStopReason(raw: string): string {
  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_")
    .slice(0, 80);
  return normalized || "unknown";
}

function mapKnownFault(error: unknown): WorkerFault {
  if (error instanceof WorkerFault) return error;
  if (error instanceof Error && error.name === "ZodError") {
    return new WorkerFault("OUTPUT_VALIDATION", { cause: error });
  }
  return normalizeFault(error);
}

function elapsed(now: () => number, startedAt: number): number {
  return Math.max(0, Math.round(now() - startedAt));
}
