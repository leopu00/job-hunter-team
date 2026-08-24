import { describe, expect, it } from "vitest";
import { z } from "zod";

import { WorkerFault } from "../src/errors.js";
import { classifyStructuredProviderError } from "../src/structured-role-worker.js";

describe("structured provider error classification", () => {
  it("lets the team retry a provider response that fails output validation", () => {
    const validationError = z.object({ score: z.number() }).safeParse({
      score: "not-a-number",
    }).error;

    const fault = classifyStructuredProviderError(validationError, false);

    expect(fault.code).toBe("OUTPUT_VALIDATION");
    expect(fault.retryable).toBe(true);
    expect(fault.cause).toBe(validationError);
  });

  it("keeps transport failures classified as provider errors", () => {
    const providerError = new Error("synthetic transport failure");

    const fault = classifyStructuredProviderError(providerError, false);

    expect(fault.code).toBe("PROVIDER_ERROR");
    expect(fault.retryable).toBe(true);
    expect(fault.cause).toBe(providerError);
  });

  it("preserves faults raised by the worker guardrails", () => {
    const original = new WorkerFault("BUDGET_EXCEEDED", {
      limit: "cost_usd",
    });

    expect(classifyStructuredProviderError(original, false)).toBe(original);
  });
});
