import { describe, expect, it } from "vitest";
import { z } from "zod";

import { WorkerFault } from "../src/errors.js";
import {
  assertLiveBudget,
  elapsed,
  knownFault,
  sanitizeStopReason,
} from "../src/worker-helpers.js";
import { fixtureProfile } from "./helpers.js";

describe("shared worker live budget", () => {
  it("lets the mock run without pricing or a paid budget", async () => {
    const profile = { ...(await fixtureProfile()), pricing: undefined };
    expect(() => assertLiveBudget(profile, 0)).not.toThrow();
  });

  it.each(["anthropic", "openai", "kimi"] as const)(
    "%s requires a positive budget and a positive token price",
    async (provider) => {
      const profile = { ...(await fixtureProfile()), provider };
      for (const [input, output] of [
        [1, 0],
        [0, 1],
        [1, 2],
      ]) {
        const paid = {
          ...profile,
          pricing: {
            inputUsdPerMillionTokens: input!,
            outputUsdPerMillionTokens: output!,
          },
        };
        expect(() => assertLiveBudget(paid, 0.01)).not.toThrow();
        for (const budget of [0, -1]) {
          expect(() => assertLiveBudget(paid, budget)).toThrowError(
            expect.objectContaining({
              code: "LIVE_BUDGET_REQUIRED",
              limit: "cost_usd",
            }),
          );
        }
      }
      for (const pricing of [undefined, profile.pricing]) {
        expect(() =>
          assertLiveBudget({ ...profile, pricing }, 0.01),
        ).toThrowError(
          expect.objectContaining({
            code: "LIVE_BUDGET_REQUIRED",
            limit: "cost_usd",
          }),
        );
      }
    },
  );
});

describe("shared worker fault mapping", () => {
  it("preserves guard faults with their cause, limit and retry policy", () => {
    const fault = new WorkerFault("BUDGET_EXCEEDED", {
      retryable: true,
      limit: "cost_usd",
      cause: new Error("synthetic guard cause"),
    });
    expect(knownFault(fault)).toBe(fault);
  });

  it("maps schema errors to output validation without changing the retry policy", () => {
    const error = z.number().safeParse("invalid").error;
    expect(knownFault(error)).toMatchObject({
      code: "OUTPUT_VALIDATION",
      retryable: false,
      cause: error,
    });
  });

  it("keeps aborts retryable and ordinary failures internal", () => {
    const abort = new Error("synthetic abort");
    abort.name = "AbortError";
    expect(knownFault(abort)).toMatchObject({
      code: "TIMEOUT",
      retryable: true,
      limit: "timeout_ms",
      cause: abort,
    });
    const error = new Error("synthetic failure");
    expect(knownFault(error)).toMatchObject({
      code: "INTERNAL_ERROR",
      retryable: false,
      cause: error,
    });
    expect(knownFault(null)).toMatchObject({
      code: "INTERNAL_ERROR",
      cause: null,
    });
  });
});

describe("shared worker audit values", () => {
  it.each([
    ["", "unknown"],
    ["STOP", "stop"],
    ["Tool-Calls_2", "tool-calls_2"],
    ["Failure: token!\n", "failure__token__"],
    [" ", "_"],
    ["é", "_"],
    ["A".repeat(81), "a".repeat(80)],
  ])("sanitizes the audit stop reason %j", (raw, expected) => {
    expect(sanitizeStopReason(raw)).toBe(expected);
  });

  it.each([
    [99, 100, 0],
    [100, 100, 0],
    [100.49, 100, 0],
    [100.5, 100, 1],
    [101.6, 100, 2],
  ])("reports elapsed time %s - %s as %s", (now, startedAt, expected) => {
    expect(elapsed(() => now, startedAt)).toBe(expected);
  });
});
