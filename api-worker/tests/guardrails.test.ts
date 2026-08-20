import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ModelProfileSchema,
  RunGuard,
  ScoutApiWorker,
  WorkerFault,
} from "../src/index.js";
import {
  cloneInput,
  fixtureInput,
  fixtureProfile,
  fixtureSource,
} from "./helpers.js";

describe("run guardrails", () => {
  it.each([
    ["steps", { maxSteps: 2 }, "STEP_LIMIT"],
    ["tool calls", { maxToolCalls: 1 }, "TOOL_CALL_LIMIT"],
    ["per-step output", { maxOutputTokensPerStep: 64 }, "OUTPUT_LIMIT"],
  ] as const)("enforces %s", async (_name, limits, code) => {
    const input = cloneInput(await fixtureInput(), { limits });
    const worker = new ScoutApiWorker(await fixtureProfile(), {
      runtimeDir: await mkdtemp(join(tmpdir(), "jht-scout-limit-")),
      source: await fixtureSource(),
    });
    const outcome = await worker.run(input);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe(code);
  });

  it("rejects an oversized initial prompt before invoking the provider", async () => {
    const base = await fixtureInput();
    const input = cloneInput(base, {
      search: {
        targetRoles: Array.from(
          { length: 8 },
          (_, index) => `${index}-${"long-input-".repeat(12)}`,
        ),
      },
      limits: { maxInputTokensPerStep: 256 },
    });
    const worker = new ScoutApiWorker(await fixtureProfile(), {
      runtimeDir: await mkdtemp(join(tmpdir(), "jht-scout-input-")),
      source: await fixtureSource(),
    });
    const outcome = await worker.run(input);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe("INPUT_LIMIT");
  });

  it("reserves the worst-case next paid step before work", async () => {
    const input = await fixtureInput();
    const paidProfile = ModelProfileSchema.parse({
      ...(await fixtureProfile()),
      provider: "openai",
      model: "verified-model-placeholder",
      pricing: {
        inputUsdPerMillionTokens: 10,
        outputUsdPerMillionTokens: 30,
      },
    });
    const guard = new RunGuard(
      { ...input.limits, maxCostUsd: 0.000001 },
      paidProfile,
    );

    expect(() => guard.beforeProviderStep("small request")).toThrowError(
      WorkerFault,
    );
    expect(guard.metrics.steps).toBe(0);
  });

  it("charges the reservation when provider usage cannot be priced", async () => {
    const input = await fixtureInput();
    const paidProfile = ModelProfileSchema.parse({
      ...(await fixtureProfile()),
      provider: "openai",
      model: "verified-model-placeholder",
      pricing: {
        inputUsdPerMillionTokens: 1,
        outputUsdPerMillionTokens: 2,
      },
    });
    const guard = new RunGuard({ ...input.limits, maxCostUsd: 1 }, paidProfile);
    const reservation = guard.beforeProviderStep("small request");
    guard.recordProviderStep(reservation, {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 99,
    });

    expect(guard.metrics.cost.estimated).toBe(true);
    expect(guard.metrics.cost.amountUsd).toBe(reservation.ceilingCostUsd);
  });

  it("prices uncached, cache-read, cache-write and output tokens separately", async () => {
    const input = await fixtureInput();
    const paidProfile = ModelProfileSchema.parse({
      ...(await fixtureProfile()),
      provider: "openai",
      model: "verified-model-placeholder",
      pricing: {
        inputUsdPerMillionTokens: 0.2,
        cachedInputUsdPerMillionTokens: 0.02,
        cacheWriteUsdPerMillionTokens: 0.25,
        outputUsdPerMillionTokens: 1.2,
      },
    });
    const guard = new RunGuard({ ...input.limits, maxCostUsd: 1 }, paidProfile);
    const reservation = guard.beforeProviderStep("small request");
    guard.recordProviderStep(reservation, {
      inputTokens: 1_000,
      inputTokenDetails: {
        noCacheTokens: 200,
        cacheReadTokens: 700,
        cacheWriteTokens: 100,
      },
      outputTokens: 50,
      outputTokenDetails: { textTokens: 30, reasoningTokens: 20 },
      totalTokens: 1_050,
    });

    expect(guard.metrics.cost.amountUsd).toBeCloseTo(0.000139, 10);
    expect(guard.metrics.cost.estimated).toBe(true);
    expect(guard.metrics.cost.basis).toBe("configured_pricing");
    expect(guard.metrics.usage.inputTokenDetails?.cacheReadTokens).toBe(700);
    expect(guard.metrics.usage.outputTokenDetails?.reasoningTokens).toBe(20);
  });

  it("accounts for provider usage before rejecting an oversized response", async () => {
    const input = await fixtureInput();
    const paidProfile = ModelProfileSchema.parse({
      ...(await fixtureProfile()),
      provider: "openai",
      model: "verified-model-placeholder",
      pricing: {
        inputUsdPerMillionTokens: 0.2,
        outputUsdPerMillionTokens: 1.2,
      },
    });
    const guard = new RunGuard({ ...input.limits, maxCostUsd: 1 }, paidProfile);
    const reservation = guard.beforeProviderStep("small request");

    expect(() =>
      guard.recordProviderStep(reservation, {
        inputTokens: input.limits.maxInputTokensPerStep + 1,
        outputTokens: 10,
        totalTokens: input.limits.maxInputTokensPerStep + 11,
      }),
    ).toThrowError(WorkerFault);

    expect(guard.metrics.pricedProviderRequests).toBe(1);
    expect(guard.metrics.usage.inputTokens).toBe(
      input.limits.maxInputTokensPerStep + 1,
    );
    expect(guard.metrics.cost.amountUsd).toBeGreaterThan(0);
  });
});
