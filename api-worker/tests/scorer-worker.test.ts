import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  API_SCORER_COMPONENT_LIMITS,
  API_SCORER_SCALE_VERSION,
  API_SCORER_TOTAL_LIMIT,
  AnalystApiWorker,
  ScorerApiWorker,
  ScorerProposalSchema,
  ScorerProviderOutputSchema,
  ScorerRoleSpec,
  ScorerWorkerInputSchema,
  buildAuthorizedScorerInput,
  type ScorerProposal,
  type ScorerWorkerInput,
  type StructuredRoleProviderAdapter,
} from "../src/index.js";
import { fixtureAnalystInput, fixtureProfile, loadFixture } from "./helpers.js";

const run = promisify(execFile);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function fixtureScorerInput(): Promise<ScorerWorkerInput> {
  return ScorerWorkerInputSchema.parse(
    await loadFixture("scorer-input.synthetic.json"),
  );
}

describe("Scorer API worker", () => {
  it("uses a versioned rubric whose component ceilings total exactly 100", () => {
    expect(API_SCORER_SCALE_VERSION).toBe("jht-100-v2");
    expect(Object.values(API_SCORER_COMPONENT_LIMITS)).toEqual([
      35, 25, 20, 10, 10,
    ]);
    expect(
      Object.values(API_SCORER_COMPONENT_LIMITS).reduce(
        (sum, value) => sum + value,
        0,
      ),
    ).toBe(API_SCORER_TOTAL_LIMIT);
  });

  it("keeps provider transport keywords portable and local validation strict", async () => {
    const transportJsonSchema = JSON.stringify(
      z.toJSONSchema(ScorerProviderOutputSchema),
    );
    for (const unsupported of [
      '"format"',
      '"pattern"',
      '"minLength"',
      '"maxLength"',
      '"minimum"',
      '"maximum"',
      '"minItems"',
      '"maxItems"',
    ]) {
      expect(transportJsonSchema).not.toContain(unsupported);
    }
    const valid = ScorerRoleSpec.buildMockOutput(await fixtureScorerInput());
    const invalidUrl = { ...valid, url: "not-a-url" };
    expect(() => ScorerProviderOutputSchema.parse(invalidUrl)).not.toThrow();
    expect(() => ScorerProposalSchema.parse(invalidUrl)).toThrow();
  });

  it("runs one authorized synthetic handoff as a proposal with no persistence", async () => {
    const outcome = await new ScorerApiWorker(await fixtureProfile(), {
      runtimeDir: await mkdtemp(join(tmpdir(), "jht-scorer-run-")),
    }).run(await fixtureScorerInput());

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result).toMatchObject({
      role: "scorer",
      disposition: "proposal_only",
      persistence: "none",
      proposal: {
        sourceId: "synthetic-job-001",
        scaleVersion: "jht-100-v2",
        totalScore: 88,
        decision: "scored",
        disposition: "proposed",
        persistence: "none",
      },
      metrics: { steps: 1, providerRequests: 1 },
    });
  });

  it("rejects missing authority, excluded analysis and cross-position handoffs", async () => {
    const input = await fixtureScorerInput();
    const withoutAuthority = structuredClone(input) as Record<string, unknown>;
    delete withoutAuthority["authorization"];
    expect(() => ScorerWorkerInputSchema.parse(withoutAuthority)).toThrow();
    expect(() =>
      ScorerWorkerInputSchema.parse({
        ...input,
        analyst: {
          ...input.analyst,
          decision: "excluded",
          exclusionTag: "SENIORITY",
        },
      }),
    ).toThrow();
    expect(() =>
      ScorerWorkerInputSchema.parse({
        ...input,
        authorization: {
          ...input.authorization,
          sourceId: "different-job",
        },
      }),
    ).toThrow();
  });

  it("builds the Analyst-to-Scorer boundary only after operator authorization", async () => {
    const analystInput = await fixtureAnalystInput();
    const analystOutcome = await new AnalystApiWorker(await fixtureProfile(), {
      runtimeDir: await mkdtemp(join(tmpdir(), "jht-handoff-analyst-")),
    }).run(analystInput);
    expect(analystOutcome.ok).toBe(true);
    if (!analystOutcome.ok) return;
    const fixture = await fixtureScorerInput();

    const scorerInput = buildAuthorizedScorerInput({
      runId: "12121212-1212-4212-8212-121212121212",
      scout: analystInput.position,
      analystResult: analystOutcome.result,
      candidate: analystInput.candidate,
      authorization: fixture.authorization,
      limits: fixture.limits,
    });

    expect(scorerInput).toMatchObject({
      role: "scorer",
      scaleVersion: "jht-100-v2",
      scout: { sourceId: "synthetic-job-001" },
      analyst: { sourceId: "synthetic-job-001", decision: "checked" },
      authorization: {
        authorized: true,
        scope: "score_position",
        sourceId: "synthetic-job-001",
      },
    });
  });

  it("rejects provider arithmetic and decision drift after token usage is recorded", async () => {
    const input = await fixtureScorerInput();
    const valid = ScorerRoleSpec.buildMockOutput(input);
    const invalid = {
      ...valid,
      totalScore: valid.totalScore - 1,
      decision: "excluded",
    } as unknown as ScorerProposal;
    const adapter: StructuredRoleProviderAdapter<
      ScorerWorkerInput,
      ScorerProposal
    > = {
      async run(context) {
        const reservation = context.guard.beforeProviderStep(context.prompt);
        await context.recordRequestStarted(reservation);
        await context.recordStep({
          reservation,
          usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
          finishReason: "stop",
        });
        return { output: invalid, rawStopReason: "stop" };
      },
    };
    const outcome = await new ScorerApiWorker(await fixtureProfile(), {
      runtimeDir: await mkdtemp(join(tmpdir(), "jht-scorer-invalid-")),
      adapter,
    }).run(input);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe("OUTPUT_VALIDATION");
    expect(() => ScorerProposalSchema.parse(invalid)).toThrow();
  });

  it("keeps paid scoring behind explicit pricing, budget, live flag and key", async () => {
    const baseInput = await fixtureScorerInput();
    const paidProfile = {
      ...(await fixtureProfile()),
      provider: "openai",
      model: "verified-model-placeholder",
      pricing: {
        inputUsdPerMillionTokens: 1,
        outputUsdPerMillionTokens: 2,
      },
    };
    const zeroBudget = await new ScorerApiWorker(paidProfile, {
      runtimeDir: await mkdtemp(join(tmpdir(), "jht-scorer-zero-budget-")),
      liveEnabled: true,
      env: {},
    }).run(baseInput);
    expect(zeroBudget.ok).toBe(false);
    if (!zeroBudget.ok)
      expect(zeroBudget.error.code).toBe("LIVE_BUDGET_REQUIRED");

    const input = {
      ...baseInput,
      limits: { ...baseInput.limits, maxCostUsd: 0.05 },
    };
    const disabled = await new ScorerApiWorker(paidProfile, {
      runtimeDir: await mkdtemp(join(tmpdir(), "jht-scorer-live-off-")),
      env: {},
    }).run(input);
    expect(disabled.ok).toBe(false);
    if (!disabled.ok) expect(disabled.error.code).toBe("LIVE_NOT_ENABLED");

    const missingKey = await new ScorerApiWorker(paidProfile, {
      runtimeDir: await mkdtemp(join(tmpdir(), "jht-scorer-live-key-")),
      liveEnabled: true,
      env: {},
    }).run(input);
    expect(missingKey.ok).toBe(false);
    if (!missingKey.ok) expect(missingKey.error.code).toBe("API_KEY_MISSING");
  });

  it("executes the packaged Scorer demo command end to end", async () => {
    const runtimeDir = await mkdtemp(join(tmpdir(), "jht-scorer-cli-"));
    const { stdout } = await run(
      process.execPath,
      ["--import", "tsx", "src/scorer-cli.ts", "--runtime-dir", runtimeDir],
      { cwd: packageRoot },
    );
    const output = JSON.parse(stdout) as {
      ok: boolean;
      result: { role: string; persistence: string };
    };
    expect(output).toMatchObject({
      ok: true,
      result: { role: "scorer", persistence: "none" },
    });
    expect(stdout).not.toContain(runtimeDir);
  }, 20_000);
});
