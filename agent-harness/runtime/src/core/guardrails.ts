/**
 * Hard limits on a single run.
 *
 * The guardrails are the runtime's own; they do not depend on any provider
 * enforcing them. Every limit is checked before a step and again after the
 * usage of that step is known, so a run stops at the first breach instead of
 * discovering it at the end.
 */

import { HarnessError } from "./errors.ts";
import { addUsage, costUsd, countedTokens, ZERO_USAGE, type Pricing, type Usage } from "./usage.ts";

export interface Limits {
  /** Maximum model calls in one run. */
  maxSteps: number;
  /** Maximum tool calls in one run. */
  maxToolCalls: number;
  /**
   * Maximum tokens in one run, counting input not served from the cache and
   * output. Cached input is left to the USD budget, the run's real cap.
   */
  maxTotalTokens: number;
  /** Maximum spend in one run, in USD. */
  budgetUsd: number;
  /** Wall-clock deadline for the whole run, in milliseconds. */
  wallClockMs: number;
  /** Maximum size of a single piece of caller-supplied input, in characters. */
  maxInputChars: number;
  /** Maximum size of a single tool result fed back to the model, in characters. */
  maxToolResultChars: number;
}

export const DEFAULT_LIMITS: Limits = {
  maxSteps: 100,
  // An agent exploring a folder makes many small calls; the token and dollar
  // caps are what bound the spend.
  maxToolCalls: 200,
  maxTotalTokens: 400_000,
  budgetUsd: 0.5,
  // Interactive sessions count the person's thinking time too.
  wallClockMs: 2 * 60 * 60_000,
  maxInputChars: 8_000,
  maxToolResultChars: 20_000,
};

export interface GuardrailState {
  steps: number;
  toolCalls: number;
  usage: Usage;
  costUsd: number;
}

export class Guardrails {
  readonly limits: Limits;

  #pricing: Pricing;
  #now: () => number;
  #startedAt: number;
  #steps = 0;
  #toolCalls = 0;
  #usage: Usage = ZERO_USAGE;
  /** Spend that is not tokens: web searches, billed per call. */
  #chargesUsd = 0;

  constructor(options: { limits: Limits; pricing: Pricing; now?: () => number }) {
    this.limits = options.limits;
    this.#pricing = options.pricing;
    this.#now = options.now ?? Date.now;
    this.#startedAt = this.#now();
  }

  get state(): GuardrailState {
    return {
      steps: this.#steps,
      toolCalls: this.#toolCalls,
      usage: this.#usage,
      costUsd: this.#spent(),
    };
  }

  /** What `usage` costs at this run's prices. */
  costOf(usage: Usage): number {
    return costUsd(usage, this.#pricing);
  }

  /** The price of one web search at this run's prices; zero when none is known. */
  get webSearchPerCallUsd(): number {
    return this.#pricing.webSearchPerCallUsd ?? 0;
  }

  /** Rejects caller-supplied input that is too large to be worth sending. */
  checkInput(text: string): void {
    if (text.length > this.limits.maxInputChars) {
      throw new HarnessError(
        "input_too_large",
        `Input is ${text.length} characters, the limit is ${this.limits.maxInputChars}.`,
      );
    }
  }

  /**
   * Claims one step. Call immediately before a model call: it throws rather
   * than letting a run exceed a limit and only then notice.
   */
  beginStep(): void {
    this.#checkDeadline();
    if (this.#steps >= this.limits.maxSteps) {
      throw new HarnessError(
        "step_limit_reached",
        `Reached the step limit of ${this.limits.maxSteps}.`,
      );
    }
    if (this.#spent() >= this.limits.budgetUsd) {
      throw new HarnessError(
        "budget_exhausted",
        `Spent ${this.#spent().toFixed(4)} USD of a ${this.limits.budgetUsd} USD budget.`,
      );
    }
    this.#steps += 1;
  }

  /** Records the usage of the step that just finished, then re-checks limits. */
  recordUsage(usage: Usage): void {
    this.#usage = addUsage(this.#usage, usage);

    // Cached input is not counted here (see `countedTokens`); the budget below prices it.
    const counted = countedTokens(this.#usage);
    if (counted > this.limits.maxTotalTokens) {
      throw new HarnessError(
        "token_limit_reached",
        `Used ${counted} tokens not served from the cache, the limit is ${this.limits.maxTotalTokens}.`,
      );
    }
    this.#checkBudget();
  }

  /** Records spend that is not tokens, such as a per-call search fee, then re-checks the budget. */
  recordCharge(usd: number): void {
    this.#chargesUsd += usd;
    this.#checkBudget();
  }

  #spent(): number {
    return costUsd(this.#usage, this.#pricing) + this.#chargesUsd;
  }

  #checkBudget(): void {
    const spent = this.#spent();
    if (spent > this.limits.budgetUsd) {
      throw new HarnessError(
        "budget_exhausted",
        `Spent ${spent.toFixed(4)} USD, over the ${this.limits.budgetUsd} USD budget.`,
      );
    }
  }

  /** Claims `count` tool calls. */
  recordToolCalls(count: number): void {
    this.#toolCalls += count;
    if (this.#toolCalls > this.limits.maxToolCalls) {
      throw new HarnessError(
        "tool_call_limit_reached",
        `Made ${this.#toolCalls} tool calls, the limit is ${this.limits.maxToolCalls}.`,
      );
    }
  }

  /** Milliseconds left before the wall-clock deadline; never negative. */
  remainingMs(): number {
    return Math.max(0, this.limits.wallClockMs - (this.#now() - this.#startedAt));
  }

  #checkDeadline(): void {
    if (this.remainingMs() <= 0) {
      throw new HarnessError(
        "deadline_exceeded",
        `Exceeded the wall-clock limit of ${this.limits.wallClockMs} ms.`,
      );
    }
  }
}
