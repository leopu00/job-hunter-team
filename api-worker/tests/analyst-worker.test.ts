import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  AnalystApiWorker,
  AnalystProviderOutputSchema,
  AnalystProposalSchema,
  MemoryAuditSink,
  type AnalystProviderAdapter,
  parseAnalystProviderOutput,
  countryCodeFromScoutLocation,
} from "../src/index.js";
import { ANALYST_SYSTEM_PROMPT } from "../src/role/analyst.js";
import { fixtureAnalystInput, fixtureProfile } from "./helpers.js";

const run = promisify(execFile);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("Analyst API worker", () => {
  it("forbids dead-link inference without supplied liveness evidence", () => {
    expect(ANALYST_SYSTEM_PROMPT).toContain("no network or URL-reading tool");
    expect(ANALYST_SYSTEM_PROMPT).toContain(
      "DEAD_LINK requires explicit supplied liveness evidence",
    );
    expect(ANALYST_SYSTEM_PROMPT).toContain("reserved .invalid domain");
  });

  it("uses a portable provider schema and restores nullable optionals locally", () => {
    const transportJsonSchema = JSON.stringify(
      z.toJSONSchema(AnalystProviderOutputSchema),
    );
    for (const unsupported of [
      '"format"',
      '"pattern"',
      '"minLength"',
      '"maxLength"',
      '"minItems"',
      '"maxItems"',
    ]) {
      expect(transportJsonSchema).not.toContain(unsupported);
    }
    expect(transportJsonSchema).not.toMatch(/"minimum":-?\d/);
    expect(transportJsonSchema).not.toMatch(/"maximum":-?\d/);
    const parsed = parseAnalystProviderOutput(
      {
        sourceId: "synthetic-job",
        url: "https://jobs.example.invalid/synthetic",
        decision: "checked",
        exclusionTag: null,
        structuredRequirements: {
          experienceRequiredYears: null,
          experienceType: "not_specified",
          degree: "not_specified",
          languagesRequired: [],
          seniority: "not_specified",
        },
        mismatchTags: [],
        teamNote: "Synthetic grounded note.",
        jdSummary: "Synthetic grounded summary.",
        roleFamily: "Software Engineering",
        location: {
          city: null,
          country: "Not specified",
          countryCode: "European Union",
          workMode: "unspecified",
        },
        salaryEstimate: null,
        company: {
          name: "Synthetic Company",
          hqCountry: null,
          sector: null,
          reviewRating: null,
          redFlags: [],
          cultureNotes: [],
          verdict: "CAUTIOUS",
        },
        highlights: [],
        disposition: "proposed",
        persistence: "none",
      },
      "EU",
    );
    expect(parsed).not.toHaveProperty("exclusionTag");
    expect(parsed).not.toHaveProperty("salaryEstimate");
    expect(parsed.company).not.toHaveProperty("hqCountry");
    expect(parsed.location.countryCode).toBe("EU");
    expect(countryCodeFromScoutLocation("Remote EU")).toBe("EU");
    expect(countryCodeFromScoutLocation("Rome, Italy")).toBe("IT");
  });

  it("runs one synthetic proposal through the real worker boundary", async () => {
    const audit = new MemoryAuditSink();
    const outcome = await new AnalystApiWorker(await fixtureProfile(), {
      runtimeDir: await mkdtemp(join(tmpdir(), "jht-analyst-run-")),
      audit,
    }).run(await fixtureAnalystInput());

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result).toMatchObject({
      role: "analyst",
      disposition: "proposal_only",
      persistence: "none",
      proposal: {
        sourceId: "synthetic-job-001",
        decision: "checked",
        roleFamily: "Platform Engineering",
        location: { countryCode: "EU", workMode: "remote" },
        company: { verdict: "CAUTIOUS" },
      },
      metrics: { steps: 1, providerRequests: 1 },
    });
    expect(outcome.result.usage.totalTokens).toBe(680);
    expect(audit.events.map((event) => event.event)).toEqual([
      "run_started",
      "provider_request",
      "provider_step",
      "run_completed",
    ]);
    expect(
      audit.events.every(
        (event) => "role" in event && event.role === "analyst",
      ),
    ).toBe(true);
  });

  it("rejects a provider proposal that changes Scout evidence identity", async () => {
    const input = await fixtureAnalystInput();
    const seed = await new AnalystApiWorker(await fixtureProfile(), {
      runtimeDir: await mkdtemp(join(tmpdir(), "jht-analyst-seed-")),
    }).run(input);
    expect(seed.ok).toBe(true);
    if (!seed.ok) throw new Error("Synthetic Analyst seed failed");
    const valid = AnalystProposalSchema.parse(seed.result.proposal);
    const adapter: AnalystProviderAdapter = {
      async run(context) {
        const reservation = context.guard.beforeProviderStep(context.prompt);
        await context.recordRequestStarted(reservation);
        await context.recordStep({
          reservation,
          usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
          finishReason: "stop",
        });
        return {
          output: { ...valid, sourceId: "substituted-source" },
          rawStopReason: "stop",
        };
      },
    };
    const outcome = await new AnalystApiWorker(await fixtureProfile(), {
      runtimeDir: await mkdtemp(join(tmpdir(), "jht-analyst-bound-")),
      adapter,
    }).run(input);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("OUTPUT_VALIDATION");
      expect(outcome.error.usage?.totalTokens).toBe(20);
      expect(outcome.error.cost?.amountUsd).toBe(0);
    }
  });

  it("keeps live mode behind explicit pricing, flag and provider key", async () => {
    const input = {
      ...(await fixtureAnalystInput()),
      limits: {
        ...(await fixtureAnalystInput()).limits,
        maxCostUsd: 0.05,
      },
    };
    const profile = {
      ...(await fixtureProfile()),
      provider: "openai",
      model: "verified-model-placeholder",
      pricing: {
        inputUsdPerMillionTokens: 1,
        outputUsdPerMillionTokens: 2,
      },
    };
    const disabled = await new AnalystApiWorker(profile, {
      runtimeDir: await mkdtemp(join(tmpdir(), "jht-analyst-live-off-")),
      env: {},
    }).run(input);
    expect(disabled.ok).toBe(false);
    if (!disabled.ok) expect(disabled.error.code).toBe("LIVE_NOT_ENABLED");

    const missingKey = await new AnalystApiWorker(profile, {
      runtimeDir: await mkdtemp(join(tmpdir(), "jht-analyst-live-key-")),
      liveEnabled: true,
      env: {},
    }).run(input);
    expect(missingKey.ok).toBe(false);
    if (!missingKey.ok) expect(missingKey.error.code).toBe("API_KEY_MISSING");
  });

  it("executes the packaged Analyst demo command end to end", async () => {
    const runtimeDir = await mkdtemp(join(tmpdir(), "jht-analyst-cli-"));
    const { stdout } = await run(
      process.execPath,
      ["--import", "tsx", "src/analyst-cli.ts", "--runtime-dir", runtimeDir],
      { cwd: packageRoot },
    );
    const output = JSON.parse(stdout) as {
      ok: boolean;
      result: { role: string };
    };
    expect(output).toMatchObject({ ok: true, result: { role: "analyst" } });
    expect(stdout).not.toContain(runtimeDir);
  }, 20_000);
});
