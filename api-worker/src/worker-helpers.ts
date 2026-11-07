import { WorkerFault, normalizeFault } from "./errors.js";
import type { ModelProfile } from "./model-profile.js";

export function assertLiveBudget(
  profile: ModelProfile,
  maxCostUsd: number,
): void {
  if (profile.provider === "mock") return;
  if (
    maxCostUsd <= 0 ||
    !profile.pricing ||
    profile.pricing.inputUsdPerMillionTokens +
      profile.pricing.outputUsdPerMillionTokens <=
      0
  ) {
    throw new WorkerFault("LIVE_BUDGET_REQUIRED", { limit: "cost_usd" });
  }
}

export function knownFault(error: unknown): WorkerFault {
  if (error instanceof WorkerFault) return error;
  if (error instanceof Error && error.name === "ZodError") {
    return new WorkerFault("OUTPUT_VALIDATION", { cause: error });
  }
  return normalizeFault(error);
}

export function sanitizeStopReason(raw: string): string {
  return (
    raw
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "_")
      .slice(0, 80) || "unknown"
  );
}

export function elapsed(now: () => number, startedAt: number): number {
  return Math.max(0, Math.round(now() - startedAt));
}
