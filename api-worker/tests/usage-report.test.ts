import { describe, expect, it } from "vitest";

import { AuditEventSchema, buildUsageReport } from "../src/index.js";

const runA = "11111111-1111-4111-8111-111111111111";
const runB = "22222222-2222-4222-8222-222222222222";
const timestamp = "2026-08-20T12:00:00.000Z";

describe("usage report", () => {
  it("separates priced requests from attempts with missing provider usage", () => {
    const events = [
      request(runA, "started", 1),
      AuditEventSchema.parse({
        contractVersion: "1",
        timestamp,
        runId: runA,
        event: "provider_step",
        provider: "openai",
        model: "gpt-test",
        step: 1,
        latencyMs: 10,
        usage: usage(1_000, 200, 700),
        cost: {
          amountUsd: 0.000324,
          estimated: true,
          basis: "configured_pricing",
        },
        webSearchCalls: 1,
        webSearchCostUsd: 0.01,
        responseId: "resp_test",
        stopReason: "stop",
      }),
      AuditEventSchema.parse({
        contractVersion: "1",
        timestamp,
        runId: runA,
        event: "run_completed",
        provider: "openai",
        model: "gpt-test",
        latencyMs: 10,
        usage: usage(1_000, 200, 700),
        cost: {
          amountUsd: 0.010324,
          estimated: true,
          basis: "configured_pricing",
        },
        toolCalls: 1,
        providerRequests: 1,
        webSearchCalls: 1,
        steps: 1,
        stopReason: "completed",
        proposalCount: 0,
      }),
      request(runB, "started", 1),
      request(runB, "failed", 1),
      AuditEventSchema.parse({
        contractVersion: "1",
        timestamp,
        runId: runB,
        event: "run_failed",
        provider: "openai",
        model: "gpt-test",
        latencyMs: 20,
        errorCode: "PROVIDER_ERROR",
        retryable: true,
        usage: usage(0, 0, 0),
        cost: {
          amountUsd: 0,
          estimated: true,
          basis: "configured_pricing",
        },
        providerRequests: 1,
        pricedProviderRequests: 0,
        toolCalls: 0,
        webSearchCalls: 0,
      }),
    ];

    const report = buildUsageReport(events);

    expect(report.totals.providerRequests).toBe(2);
    expect(report.totals.pricedProviderRequests).toBe(1);
    expect(report.totals.missingUsageRequests).toBe(1);
    expect(report.totals.legacyRunsWithUnknownUsage).toBe(0);
    expect(report.totals.telemetryComplete).toBe(false);
    expect(report.totals.billingFullyReconciled).toBe(false);
    expect(report.totals.webSearchCalls).toBe(1);
    expect(report.totals.usage.inputTokenDetails?.cacheReadTokens).toBe(700);
    expect(report.totals.projectedCostUsd).toBe(0.010324);
    expect(report.runs.find((run) => run.runId === runB)).toMatchObject({
      status: "failed",
      instrumentation: "request-aware",
      missingUsageRequests: 1,
      billingReconciled: false,
    });
  });
});

function request(runId: string, phase: "started" | "failed", step: number) {
  return AuditEventSchema.parse({
    contractVersion: "1",
    timestamp,
    runId,
    event: "provider_request",
    phase,
    provider: "openai",
    model: "gpt-test",
    step,
    ...(phase === "failed"
      ? { latencyMs: 20, failureReason: "provider_error" }
      : {}),
  });
}

function usage(inputTokens: number, outputTokens: number, cacheRead: number) {
  return {
    inputTokens,
    inputTokenDetails: {
      noCacheTokens: inputTokens - cacheRead,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: 0,
    },
    outputTokens,
    outputTokenDetails: { textTokens: outputTokens, reasoningTokens: 0 },
    totalTokens: inputTokens + outputTokens,
  };
}
