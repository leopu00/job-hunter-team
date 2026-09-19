import { describe, expect, it } from "vitest";

import { isHarnessError } from "../src/core/errors.ts";
import { DEFAULT_LIMITS, Guardrails, type Limits } from "../src/core/guardrails.ts";

const FREE = { inputPerMTokUsd: 0, outputPerMTokUsd: 0 };
const PRICEY = { inputPerMTokUsd: 1_000, outputPerMTokUsd: 1_000 };

function limits(overrides: Partial<Limits> = {}): Limits {
  return { ...DEFAULT_LIMITS, ...overrides };
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return isHarnessError(error) ? error.code : `unexpected:${String(error)}`;
  }
  return "no_error";
}

describe("Guardrails", () => {
  it("stops at the step limit", () => {
    const g = new Guardrails({ limits: limits({ maxSteps: 2 }), pricing: FREE });
    g.beginStep();
    g.beginStep();
    expect(codeOf(() => g.beginStep())).toBe("step_limit_reached");
  });

  it("stops at the tool-call limit", () => {
    const g = new Guardrails({ limits: limits({ maxToolCalls: 1 }), pricing: FREE });
    g.recordToolCalls(1);
    expect(codeOf(() => g.recordToolCalls(1))).toBe("tool_call_limit_reached");
  });

  it("stops at the token limit", () => {
    const g = new Guardrails({ limits: limits({ maxTotalTokens: 100 }), pricing: FREE });
    expect(codeOf(() => g.recordUsage({ inputTokens: 80, outputTokens: 40 }))).toBe(
      "token_limit_reached",
    );
  });

  it("stops when the usage of a step goes over budget", () => {
    const g = new Guardrails({ limits: limits({ budgetUsd: 0.01 }), pricing: PRICEY });
    g.beginStep();
    // 1000 tokens at 1000 USD per million is 1 USD, a hundred times the budget.
    expect(codeOf(() => g.recordUsage({ inputTokens: 500, outputTokens: 500 }))).toBe(
      "budget_exhausted",
    );
  });

  it("refuses to start a step once the wall clock has run out", () => {
    let clock = 0;
    const g = new Guardrails({
      limits: limits({ wallClockMs: 1_000 }),
      pricing: FREE,
      now: () => clock,
    });
    g.beginStep();
    clock = 1_001;
    expect(codeOf(() => g.beginStep())).toBe("deadline_exceeded");
  });

  it("rejects oversized input", () => {
    const g = new Guardrails({ limits: limits({ maxInputChars: 10 }), pricing: FREE });
    expect(codeOf(() => g.checkInput("x".repeat(11)))).toBe("input_too_large");
  });

  it("accumulates usage and cost across steps", () => {
    const g = new Guardrails({
      limits: limits({ maxTotalTokens: 5_000_000, budgetUsd: 100 }),
      pricing: { inputPerMTokUsd: 2, outputPerMTokUsd: 10 },
    });
    g.recordUsage({ inputTokens: 1_000_000, outputTokens: 100_000 });
    g.recordUsage({ inputTokens: 0, outputTokens: 100_000 });
    expect(g.state.usage).toMatchObject({ inputTokens: 1_000_000, outputTokens: 200_000 });
    expect(g.state.costUsd).toBeCloseTo(2 + 2, 6);
  });
});

describe("Guardrails — charges", () => {
  it("adds per-call charges to spend and stops the run past the budget", () => {
    const g = new Guardrails({
      limits: { ...DEFAULT_LIMITS, budgetUsd: 0.05 },
      pricing: { inputPerMTokUsd: 0, outputPerMTokUsd: 0, webSearchPerCallUsd: 0.01 },
    });
    g.recordCharge(0.04);
    expect(g.state.costUsd).toBeCloseTo(0.04, 9);
    expect(g.webSearchPerCallUsd).toBe(0.01);
    expect(() => g.recordCharge(0.02)).toThrowError(expect.objectContaining({ code: "budget_exhausted" }));
  });
});
