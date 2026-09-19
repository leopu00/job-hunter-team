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

describe("Guardrails — the token limit leaves cached input to the budget (T9)", () => {
  it("does not count input served from the cache", () => {
    const g = new Guardrails({ limits: limits({ maxTotalTokens: 100 }), pricing: FREE });
    // 1,000 in, 950 of them cached: 50 + 40 out = 90 counted.
    expect(codeOf(() => g.recordUsage({ inputTokens: 1_000, cachedInputTokens: 950, outputTokens: 40 }))).toBe("no_error");
    expect(codeOf(() => g.recordUsage({ inputTokens: 20, cachedInputTokens: 0, outputTokens: 0 }))).toBe("token_limit_reached");
  });

  it("counts cache writes, which are input the cache did not serve", () => {
    const g = new Guardrails({ limits: limits({ maxTotalTokens: 100 }), pricing: FREE });
    expect(codeOf(() => g.recordUsage({ inputTokens: 120, cachedInputTokens: 0, cacheWriteTokens: 110, outputTokens: 0 }))).toBe(
      "token_limit_reached",
    );
  });

  it("still stops on the budget, which prices every cached token", () => {
    const g = new Guardrails({ limits: limits({ maxTotalTokens: 1_000, budgetUsd: 0.5 }), pricing: PRICEY });
    expect(codeOf(() => g.recordUsage({ inputTokens: 1_000_000, cachedInputTokens: 1_000_000, outputTokens: 0 }))).toBe(
      "budget_exhausted",
    );
  });
});

describe("a mock run with a million cached tokens (T9)", () => {
  it("is not stopped by the token limit, as T5-bis was at round 16", async () => {
    const { MockProvider } = await import("../src/core/provider/mock.ts");
    const { RoleSession } = await import("../src/core/role-session.ts");
    const { MemoryAuditLog } = await import("../src/core/audit.ts");
    const { z } = await import("zod");
    // T5-bis: ~31k tokens of context a round, 87 % of it cached. Twenty rounds of it:
    // 620k input in all, 1M+ with the last rounds', far past the 400k limit if cache counted.
    const round = { inputTokens: 55_000, cachedInputTokens: 52_000, outputTokens: 300 };
    const script = [
      ...Array.from({ length: 20 }, (_, i) => ({ toolCalls: [{ name: "noop", args: { i } }], usage: round })),
      { text: "done", usage: round },
    ];
    const provider = new MockProvider(script);
    const guardrails = new Guardrails({ limits: limits(), pricing: FREE });
    const session = new RoleSession({
      provider,
      guardrails,
      audit: new MemoryAuditLog(),
      systemPrompt: "You are a test role.",
      tools: [
        {
          spec: { name: "noop", description: "Does nothing.", schema: z.object({ i: z.number() }).strict() },
          classify: () => ({ risk: "none", paths: [], summary: "noop" }),
          execute: async () => ({ ok: true, content: "ok" }),
        },
      ],
    });
    const turn = await session.send("Go.");
    expect(turn.text).toBe("done");
    expect(turn.stats.usage.inputTokens).toBe(21 * 55_000);
    expect(turn.stats.usage.cachedInputTokens).toBeGreaterThan(1_000_000);
    expect(guardrails.state.steps).toBe(21);
  });
});
