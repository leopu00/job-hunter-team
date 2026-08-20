import type { RunLimits, Usage } from "./contract.js";
import { UsageSchema } from "./contract.js";
import { WorkerFault } from "./errors.js";
import type { ModelProfile } from "./model-profile.js";

export type StepReservation = {
  step: number;
  startedAtMs: number;
  ceilingCostUsd: number;
};

export type RecordedStep = {
  step: number;
  latencyMs: number;
  usage: Usage;
  cost: {
    amountUsd: number;
    estimated: boolean;
    basis: "none" | "configured_pricing" | "reserved_ceiling";
  };
};

export class RunGuard {
  private stepCount = 0;
  private toolCallCount = 0;
  private webSearchCount = 0;
  private pricedProviderRequestCount = 0;
  private totalInputTokens = 0;
  private totalNoCacheInputTokens = 0;
  private totalCacheReadInputTokens = 0;
  private totalCacheWriteInputTokens = 0;
  private totalOutputTokens = 0;
  private totalTextOutputTokens = 0;
  private totalReasoningOutputTokens = 0;
  private totalCostUsd = 0;
  private hasEstimatedCost = false;
  private usedReservedCeiling = false;

  constructor(
    readonly limits: RunLimits,
    private readonly profile: ModelProfile,
    private readonly now: () => number = Date.now,
  ) {}

  estimateTokens(serializedValue: string): number {
    // Provider-neutral upper bound: a tokenizer cannot consume more tokens
    // than there are UTF-8 bytes in the serialized request. This deliberately
    // sacrifices capacity so the pre-request gate cannot rely on the usual,
    // but non-guaranteed, bytes-per-token heuristic.
    return Buffer.byteLength(serializedValue, "utf8");
  }

  assertInitialInput(serializedValue: string): void {
    this.assertInputTokens(this.estimateTokens(serializedValue));
  }

  beforeProviderStep(serializedRequest: string): StepReservation {
    if (this.stepCount >= this.limits.maxSteps) {
      throw new WorkerFault("STEP_LIMIT", { limit: "steps" });
    }

    const estimatedInputTokens = this.estimateTokens(serializedRequest);
    this.assertInputTokens(estimatedInputTokens);

    const ceilingCostUsd = this.price(
      estimatedInputTokens,
      this.limits.maxOutputTokensPerStep,
    );
    if (
      this.profile.provider !== "mock" &&
      this.totalCostUsd +
        ceilingCostUsd +
        this.remainingWebSearchReservation() >
        this.limits.maxCostUsd + 1e-12
    ) {
      throw new WorkerFault("BUDGET_EXCEEDED", { limit: "cost_usd" });
    }

    this.stepCount += 1;
    return {
      step: this.stepCount,
      startedAtMs: this.now(),
      ceilingCostUsd,
    };
  }

  recordProviderStep(
    reservation: StepReservation,
    rawUsage: Usage,
  ): RecordedStep {
    const usage = UsageSchema.parse(rawUsage);
    this.totalInputTokens += usage.inputTokens;
    this.totalOutputTokens += usage.outputTokens;
    this.totalNoCacheInputTokens +=
      usage.inputTokenDetails?.noCacheTokens ?? usage.inputTokens;
    this.totalCacheReadInputTokens +=
      usage.inputTokenDetails?.cacheReadTokens ?? 0;
    this.totalCacheWriteInputTokens +=
      usage.inputTokenDetails?.cacheWriteTokens ?? 0;
    this.totalTextOutputTokens +=
      usage.outputTokenDetails?.textTokens ?? usage.outputTokens;
    this.totalReasoningOutputTokens +=
      usage.outputTokenDetails?.reasoningTokens ?? 0;

    // A provider may expose only a total token count. That is observable but
    // not enough to price input/output safely, so fall back to the reserved
    // ceiling unless the billable categories themselves are present.
    const usageAvailable = usage.inputTokens + usage.outputTokens > 0;
    const priced = usageAvailable
      ? this.priceUsage(usage)
      : {
          amountUsd: reservation.ceilingCostUsd,
          estimated: true,
          basis: "reserved_ceiling" as const,
        };
    const { amountUsd, estimated, basis } = priced;
    this.pricedProviderRequestCount += 1;
    this.usedReservedCeiling ||= basis === "reserved_ceiling";
    this.totalCostUsd += amountUsd;
    this.hasEstimatedCost ||= estimated;

    // The provider has already performed and billed this request. Account for
    // its returned usage before enforcing post-response limits so a rejected
    // oversized response cannot disappear from the run ledger.
    if (usage.inputTokens > 0) this.assertInputTokens(usage.inputTokens);
    if (usage.outputTokens > this.limits.maxOutputTokensPerStep) {
      throw new WorkerFault("OUTPUT_LIMIT", {
        limit: "output_tokens_per_step",
      });
    }
    if (this.totalOutputTokens > this.limits.maxTotalOutputTokens) {
      throw new WorkerFault("OUTPUT_LIMIT", {
        limit: "total_output_tokens",
      });
    }
    if (
      this.profile.provider !== "mock" &&
      this.totalCostUsd > this.limits.maxCostUsd + 1e-12
    ) {
      throw new WorkerFault("BUDGET_EXCEEDED", { limit: "cost_usd" });
    }

    return {
      step: reservation.step,
      latencyMs: Math.max(0, Math.round(this.now() - reservation.startedAtMs)),
      usage,
      cost: { amountUsd, estimated, basis },
    };
  }

  beforeToolCall(): void {
    if (this.toolCallCount >= this.limits.maxToolCalls) {
      throw new WorkerFault("TOOL_CALL_LIMIT", { limit: "tool_calls" });
    }
    this.toolCallCount += 1;
  }

  recordWebSearchCalls(count: number): number {
    if (!Number.isInteger(count) || count < 0) {
      throw new WorkerFault("INTERNAL_ERROR");
    }
    if (this.webSearchCount + count > this.limits.maxWebSearches) {
      throw new WorkerFault("TOOL_CALL_LIMIT", { limit: "tool_calls" });
    }
    if (this.toolCallCount + count > this.limits.maxToolCalls) {
      throw new WorkerFault("TOOL_CALL_LIMIT", { limit: "tool_calls" });
    }
    this.webSearchCount += count;
    this.toolCallCount += count;
    const costUsd = count * (this.profile.pricing?.webSearchUsdPerCall ?? 0);
    this.totalCostUsd += costUsd;
    if (count > 0 && this.profile.provider !== "mock") {
      this.hasEstimatedCost = true;
    }
    if (
      this.profile.provider !== "mock" &&
      this.totalCostUsd > this.limits.maxCostUsd + 1e-12
    ) {
      throw new WorkerFault("BUDGET_EXCEEDED", { limit: "cost_usd" });
    }
    return costUsd;
  }

  assertResult(serializedResult: string): void {
    if (
      Buffer.byteLength(serializedResult, "utf8") > this.limits.maxResultBytes
    ) {
      throw new WorkerFault("OUTPUT_LIMIT", { limit: "result_bytes" });
    }
  }

  get metrics() {
    return {
      steps: this.stepCount,
      providerRequests: this.stepCount,
      pricedProviderRequests: this.pricedProviderRequestCount,
      toolCalls: this.toolCallCount,
      webSearchCalls: this.webSearchCount,
      usage: {
        inputTokens: this.totalInputTokens,
        inputTokenDetails: {
          noCacheTokens: this.totalNoCacheInputTokens,
          cacheReadTokens: this.totalCacheReadInputTokens,
          cacheWriteTokens: this.totalCacheWriteInputTokens,
        },
        outputTokens: this.totalOutputTokens,
        outputTokenDetails: {
          textTokens: this.totalTextOutputTokens,
          reasoningTokens: this.totalReasoningOutputTokens,
        },
        totalTokens: this.totalInputTokens + this.totalOutputTokens,
      },
      cost: {
        amountUsd: this.totalCostUsd,
        estimated: this.hasEstimatedCost,
        basis:
          this.profile.provider === "mock"
            ? ("none" as const)
            : this.usedReservedCeiling
              ? ("reserved_ceiling" as const)
              : ("configured_pricing" as const),
      },
    };
  }

  private assertInputTokens(estimatedTokens: number): void {
    if (estimatedTokens > this.limits.maxInputTokensPerStep) {
      throw new WorkerFault("INPUT_LIMIT", {
        limit: "input_tokens_per_step",
      });
    }
  }

  private price(inputTokens: number, outputTokens: number): number {
    if (!this.profile.pricing) return 0;
    return (
      (inputTokens * this.profile.pricing.inputUsdPerMillionTokens +
        outputTokens * this.profile.pricing.outputUsdPerMillionTokens) /
      1_000_000
    );
  }

  private priceUsage(usage: Usage): {
    amountUsd: number;
    estimated: boolean;
    basis: "none" | "configured_pricing";
  } {
    if (!this.profile.pricing || this.profile.provider === "mock") {
      return { amountUsd: 0, estimated: false, basis: "none" };
    }
    const details = usage.inputTokenDetails;
    const cacheReadTokens = details?.cacheReadTokens ?? 0;
    const cacheWriteTokens = details?.cacheWriteTokens ?? 0;
    const noCacheTokens =
      details?.noCacheTokens ??
      Math.max(0, usage.inputTokens - cacheReadTokens - cacheWriteTokens);
    const cachedRate =
      this.profile.pricing.cachedInputUsdPerMillionTokens ??
      this.profile.pricing.inputUsdPerMillionTokens;
    const cacheWriteRate =
      this.profile.pricing.cacheWriteUsdPerMillionTokens ??
      this.profile.pricing.inputUsdPerMillionTokens;
    const amountUsd =
      (noCacheTokens * this.profile.pricing.inputUsdPerMillionTokens +
        cacheReadTokens * cachedRate +
        cacheWriteTokens * cacheWriteRate +
        usage.outputTokens * this.profile.pricing.outputUsdPerMillionTokens) /
      1_000_000;
    return {
      amountUsd,
      // Provider usage plus configured prices is still a projection until it
      // is reconciled against OpenAI's organization Costs endpoint.
      estimated: true,
      basis: "configured_pricing",
    };
  }

  private remainingWebSearchReservation(): number {
    const price = this.profile.pricing?.webSearchUsdPerCall ?? 0;
    return (
      Math.max(0, this.limits.maxWebSearches - this.webSearchCount) * price
    );
  }
}
