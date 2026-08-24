import { describe, expect, it } from "vitest";
import { boundedBackoffDelay } from "../../../cli/src/lib/bounded-backoff.js";

describe("boundedBackoffDelay", () => {
  it("cresce esponenzialmente ma non supera il cap", () => {
    const opts = { minMs: 5_000, maxMs: 60_000, jitter: 0, random: () => 0.5 };
    expect([0, 1, 2, 3, 4, 20].map((n) => boundedBackoffDelay(n, opts))).toEqual([
      5_000, 10_000, 20_000, 40_000, 60_000, 60_000,
    ]);
  });

  it("applica jitter senza uscire dai limiti", () => {
    const low = boundedBackoffDelay(2, {
      minMs: 5_000, maxMs: 60_000, jitter: 0.2, random: () => 0,
    });
    const high = boundedBackoffDelay(2, {
      minMs: 5_000, maxMs: 60_000, jitter: 0.2, random: () => 1,
    });
    expect(low).toBe(16_000);
    expect(high).toBe(24_000);
  });

  it("satura input estremi e non produce intervalli invalidi", () => {
    expect(boundedBackoffDelay(-10, { minMs: 100, maxMs: 1_000, jitter: 0 })).toBe(100);
    expect(boundedBackoffDelay(10_000, { minMs: 100, maxMs: 1_000, jitter: 0 })).toBe(1_000);
  });
});
