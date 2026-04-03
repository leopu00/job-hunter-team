/**
 * Test unitari retry — backoff, resolveRetryPolicy, retryAsync
 *
 * Esecuzione: npx vitest run tests/js/queue/retry.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  computeBackoff,
  resolveRetryPolicy,
  retryAsync,
} from "../../../shared/queue/retry.js";
import { DEFAULT_RETRY_POLICY } from "../../../shared/queue/types.js";

describe("resolveRetryPolicy", () => {
  it("ritorna default senza overrides", () => {
    const policy = resolveRetryPolicy();
    expect(policy).toEqual(DEFAULT_RETRY_POLICY);
  });

  it("applica overrides parziali mantenendo default", () => {
    const policy = resolveRetryPolicy({ maxAttempts: 5 });
    expect(policy.maxAttempts).toBe(5);
    expect(policy.initialDelayMs).toBe(DEFAULT_RETRY_POLICY.initialDelayMs);
    expect(policy.factor).toBe(DEFAULT_RETRY_POLICY.factor);
  });

  it("applica tutti gli overrides", () => {
    const policy = resolveRetryPolicy({
      maxAttempts: 10, initialDelayMs: 100, maxDelayMs: 5000, factor: 3, jitter: 0.5,
    });
    expect(policy.maxAttempts).toBe(10);
    expect(policy.initialDelayMs).toBe(100);
    expect(policy.maxDelayMs).toBe(5000);
    expect(policy.factor).toBe(3);
    expect(policy.jitter).toBe(0.5);
  });
});

describe("computeBackoff", () => {
  it("primo tentativo vicino a initialDelayMs", () => {
    const policy = resolveRetryPolicy({ jitter: 0 });
    expect(computeBackoff(policy, 1)).toBe(300);
  });

  it("backoff esponenziale con factor 2", () => {
    const policy = resolveRetryPolicy({ jitter: 0 });
    expect(computeBackoff(policy, 2)).toBe(600);
    expect(computeBackoff(policy, 3)).toBe(1200);
  });

  it("non supera maxDelayMs", () => {
    const policy = resolveRetryPolicy({ maxDelayMs: 500, jitter: 0 });
    expect(computeBackoff(policy, 10)).toBe(500);
  });

  it("jitter aggiunge variabilita", () => {
    const policy = resolveRetryPolicy({ jitter: 0.5 });
    const delays = Array.from({ length: 20 }, () => computeBackoff(policy, 1));
    const unique = new Set(delays);
    expect(unique.size).toBeGreaterThan(1);
  });
});

describe("retryAsync", () => {
  it("ritorna risultato al primo tentativo se ok", async () => {
    const result = await retryAsync(async () => "ok", { maxAttempts: 3, initialDelayMs: 1 });
    expect(result).toBe("ok");
  });

  it("riprova e riesce dopo fallimenti iniziali", async () => {
    let count = 0;
    const result = await retryAsync(async () => {
      count++;
      if (count < 3) throw new Error("fail");
      return "recovered";
    }, { maxAttempts: 5, initialDelayMs: 5, maxDelayMs: 10 });
    expect(result).toBe("recovered");
    expect(count).toBe(3);
  });

  it("lancia errore dopo maxAttempts esauriti", async () => {
    let count = 0;
    await expect(retryAsync(async () => {
      count++;
      throw new Error("sempre");
    }, { maxAttempts: 3, initialDelayMs: 5, maxDelayMs: 10 })).rejects.toThrow("sempre");
    expect(count).toBe(3);
  });

  it("accetta numero come shorthand per maxAttempts", async () => {
    let count = 0;
    await expect(retryAsync(async () => {
      count++;
      throw new Error("fail");
    }, 2)).rejects.toThrow("fail");
    expect(count).toBe(2);
  });

  it("shouldRetry false interrompe subito", async () => {
    let count = 0;
    await expect(retryAsync(async () => {
      count++;
      throw new Error("permanent");
    }, { maxAttempts: 5, initialDelayMs: 5, shouldRetry: () => false })).rejects.toThrow("permanent");
    expect(count).toBe(1);
  });

  it("onRetry riceve info su ogni retry", async () => {
    const retries: number[] = [];
    let count = 0;
    await retryAsync(async () => {
      count++;
      if (count < 3) throw new Error("retry");
      return "done";
    }, {
      maxAttempts: 5, initialDelayMs: 5, maxDelayMs: 10, label: "test-op",
      onRetry: (info) => { retries.push(info.attempt); },
    });
    expect(retries).toEqual([1, 2]);
  });
});
