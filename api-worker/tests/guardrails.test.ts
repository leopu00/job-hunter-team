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
});
