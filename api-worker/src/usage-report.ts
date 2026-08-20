import type { AuditEvent, Usage } from "./contract.js";

export type ScoutUsageRun = {
  runId: string;
  status: "completed" | "failed" | "incomplete";
  instrumentation: "legacy" | "request-aware";
  providerRequests: number;
  pricedProviderRequests: number;
  missingUsageRequests: number | null;
  webSearchCalls: number;
  usage: Usage;
  projectedCostUsd: number;
  billingReconciled: boolean;
};

export type ScoutUsageReport = {
  runs: ScoutUsageRun[];
  totals: {
    providerRequests: number;
    pricedProviderRequests: number;
    missingUsageRequests: number;
    legacyRunsWithUnknownUsage: number;
    webSearchCalls: number;
    usage: Usage;
    projectedCostUsd: number;
    billingReconciledUsd: number;
    telemetryComplete: boolean;
    billingFullyReconciled: boolean;
  };
};

export function buildUsageReport(events: AuditEvent[]): ScoutUsageReport {
  const byRun = new Map<string, AuditEvent[]>();
  for (const event of events) {
    if (!event.runId) continue;
    const runEvents = byRun.get(event.runId) ?? [];
    runEvents.push(event);
    byRun.set(event.runId, runEvents);
  }

  const runs = [...byRun.entries()]
    .map(([runId, runEvents]) => summarizeRun(runId, runEvents))
    .filter((run): run is ScoutUsageRun => run !== undefined);
  const totals = {
    providerRequests: 0,
    pricedProviderRequests: 0,
    missingUsageRequests: 0,
    legacyRunsWithUnknownUsage: 0,
    webSearchCalls: 0,
    usage: emptyUsage(),
    projectedCostUsd: 0,
    billingReconciledUsd: 0,
    telemetryComplete: true,
    billingFullyReconciled: true,
  };
  for (const run of runs) {
    totals.providerRequests += run.providerRequests;
    totals.pricedProviderRequests += run.pricedProviderRequests;
    totals.missingUsageRequests += run.missingUsageRequests ?? 0;
    if (run.missingUsageRequests === null) {
      totals.legacyRunsWithUnknownUsage += 1;
      totals.telemetryComplete = false;
    } else if (run.missingUsageRequests > 0) {
      totals.telemetryComplete = false;
    }
    totals.webSearchCalls += run.webSearchCalls;
    totals.usage = addUsage(totals.usage, run.usage);
    totals.projectedCostUsd += run.projectedCostUsd;
    if (run.billingReconciled) {
      totals.billingReconciledUsd += run.projectedCostUsd;
    } else {
      totals.billingFullyReconciled = false;
    }
  }
  totals.projectedCostUsd = roundUsd(totals.projectedCostUsd);
  totals.billingReconciledUsd = roundUsd(totals.billingReconciledUsd);
  return { runs, totals };
}

function summarizeRun(
  runId: string,
  events: AuditEvent[],
): ScoutUsageRun | undefined {
  const steps = events.filter((event) => event.event === "provider_step");
  const requestStarts = events.filter(
    (event) => event.event === "provider_request" && event.phase === "started",
  );
  const terminal = [...events]
    .reverse()
    .find(
      (event) =>
        event.event === "run_completed" || event.event === "run_failed",
    );
  if (steps.length === 0 && requestStarts.length === 0 && !terminal) {
    return undefined;
  }

  const instrumentation = requestStarts.length > 0 ? "request-aware" : "legacy";
  const terminalUsage =
    terminal && "usage" in terminal ? terminal.usage : undefined;
  const usage = terminalUsage ?? sumStepUsage(steps);
  const providerRequests =
    terminal &&
    "providerRequests" in terminal &&
    terminal.providerRequests != null
      ? terminal.providerRequests
      : Math.max(requestStarts.length, steps.length);
  const pricedProviderRequests =
    terminal &&
    "pricedProviderRequests" in terminal &&
    terminal.pricedProviderRequests != null
      ? terminal.pricedProviderRequests
      : steps.length;
  const terminalCost =
    terminal && "cost" in terminal ? terminal.cost : undefined;
  const projectedCostUsd = roundUsd(
    terminalCost?.amountUsd ??
      steps.reduce(
        (sum, step) => sum + step.cost.amountUsd + (step.webSearchCostUsd ?? 0),
        0,
      ),
  );
  const webSearchCalls =
    terminal && "webSearchCalls" in terminal && terminal.webSearchCalls != null
      ? terminal.webSearchCalls
      : steps.reduce((sum, step) => sum + (step.webSearchCalls ?? 0), 0);
  return {
    runId,
    status:
      terminal?.event === "run_completed"
        ? "completed"
        : terminal?.event === "run_failed"
          ? "failed"
          : "incomplete",
    instrumentation,
    providerRequests,
    pricedProviderRequests,
    missingUsageRequests:
      instrumentation === "request-aware"
        ? Math.max(0, providerRequests - pricedProviderRequests)
        : null,
    webSearchCalls,
    usage,
    projectedCostUsd,
    billingReconciled: terminalCost?.basis === "billing",
  };
}

function sumStepUsage(
  steps: Extract<AuditEvent, { event: "provider_step" }>[],
): Usage {
  return steps.reduce(
    (total, step) => addUsage(total, step.usage),
    emptyUsage(),
  );
}

function emptyUsage(): Usage {
  return {
    inputTokens: 0,
    inputTokenDetails: {
      noCacheTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    outputTokens: 0,
    outputTokenDetails: { textTokens: 0, reasoningTokens: 0 },
    totalTokens: 0,
  };
}

function addUsage(left: Usage, right: Usage): Usage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    inputTokenDetails: {
      noCacheTokens:
        (left.inputTokenDetails?.noCacheTokens ?? left.inputTokens) +
        (right.inputTokenDetails?.noCacheTokens ?? right.inputTokens),
      cacheReadTokens:
        (left.inputTokenDetails?.cacheReadTokens ?? 0) +
        (right.inputTokenDetails?.cacheReadTokens ?? 0),
      cacheWriteTokens:
        (left.inputTokenDetails?.cacheWriteTokens ?? 0) +
        (right.inputTokenDetails?.cacheWriteTokens ?? 0),
    },
    outputTokens: left.outputTokens + right.outputTokens,
    outputTokenDetails: {
      textTokens:
        (left.outputTokenDetails?.textTokens ?? left.outputTokens) +
        (right.outputTokenDetails?.textTokens ?? right.outputTokens),
      reasoningTokens:
        (left.outputTokenDetails?.reasoningTokens ?? 0) +
        (right.outputTokenDetails?.reasoningTokens ?? 0),
    },
    totalTokens: left.totalTokens + right.totalTokens,
  };
}

function roundUsd(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000_000) / 1_000_000_000;
}
