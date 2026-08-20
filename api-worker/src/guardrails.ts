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
  cost: { amountUsd: number; estimated: boolean };
};

export class RunGuard {
  private stepCount = 0;
  private toolCallCount = 0;
  private webSearchCount = 0;
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private totalCostUsd = 0;
  private hasEstimatedCost = false;

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
    if (usage.inputTokens > 0) this.assertInputTokens(usage.inputTokens);
    this.totalInputTokens += usage.inputTokens;
    this.totalOutputTokens += usage.outputTokens;

    if (usage.outputTokens > this.limits.maxOutputTokensPerStep) {
      throw new WorkerFault("OUTPUT_LIMIT", {
        limit: "output_tokens_per_step",
      });
    }

    // A provider may expose only a total token count. That is observable but
    // not enough to price input/output safely, so fall back to the reserved
    // ceiling unless the billable categories themselves are present.
    const usageAvailable = usage.inputTokens + usage.outputTokens > 0;
    const amountUsd = usageAvailable
      ? this.price(usage.inputTokens, usage.outputTokens)
      : reservation.ceilingCostUsd;
    const estimated = !usageAvailable;
    this.totalCostUsd += amountUsd;
    this.hasEstimatedCost ||= estimated;

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
      cost: { amountUsd, estimated },
    };
  }

  beforeToolCall(): void {
    if (this.toolCallCount >= this.limits.maxToolCalls) {
      throw new WorkerFault("TOOL_CALL_LIMIT", { limit: "tool_calls" });
    }
    this.toolCallCount += 1;
  }

  recordWebSearchCalls(count: number): void {
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
    this.totalCostUsd +=
      count * (this.profile.pricing?.webSearchUsdPerCall ?? 0);
    if (
      this.profile.provider !== "mock" &&
      this.totalCostUsd > this.limits.maxCostUsd + 1e-12
    ) {
      throw new WorkerFault("BUDGET_EXCEEDED", { limit: "cost_usd" });
    }
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
      toolCalls: this.toolCallCount,
      usage: {
        inputTokens: this.totalInputTokens,
        outputTokens: this.totalOutputTokens,
        totalTokens: this.totalInputTokens + this.totalOutputTokens,
      },
      cost: {
        amountUsd: this.totalCostUsd,
        estimated: this.hasEstimatedCost,
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

  private remainingWebSearchReservation(): number {
    const price = this.profile.pricing?.webSearchUsdPerCall ?? 0;
    return (
      Math.max(0, this.limits.maxWebSearches - this.webSearchCount) * price
    );
  }
}
