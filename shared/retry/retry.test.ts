import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CircuitBreaker,
  CircuitBreakerOpenError,
} from "./circuit-breaker.js";
import {
  retryAsync,
  resolveRetryConfig,
  computeBackoff,
  isTransientError,
  createRetryRunner,
} from "./retry.js";
import { DEFAULT_RETRY_CONFIG, DEFAULT_CIRCUIT_CONFIG } from "./types.js";

// ── Circuit Breaker ────────────────────────────────────────

describe("CircuitBreaker", () => {
  it("parte in stato closed", () => {
    const cb = new CircuitBreaker();
    const status = cb.getStatus();
    assert.equal(status.state, "closed");
    assert.equal(status.failures, 0);
  });

  it("resta closed sotto la soglia di errori", () => {
    const cb = new CircuitBreaker({ failureThreshold: 3 });
    cb.onFailure();
    cb.onFailure();
    assert.equal(cb.getStatus().state, "closed");
    assert.equal(cb.isCallPermitted(), true);
  });

  it("apre dopo failureThreshold errori consecutivi", () => {
    const cb = new CircuitBreaker({ failureThreshold: 2 });
    cb.onFailure();
    cb.onFailure();
    assert.equal(cb.getStatus().state, "open");
    assert.equal(cb.isCallPermitted(), false);
  });

  it("lancia CircuitBreakerOpenError quando aperto", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 60_000 });
    cb.onFailure();
    await assert.rejects(
      () => cb.execute(() => Promise.resolve("ok")),
      (err) => err instanceof CircuitBreakerOpenError && err.remainingMs > 0,
    );
  });

  it("transita a half-open dopo resetTimeoutMs", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 10 });
    cb.onFailure();
    assert.equal(cb.getStatus().state, "open");
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(cb.getStatus().state, "half-open");
    assert.equal(cb.isCallPermitted(), true);
  });

  it("chiude dopo halfOpenSuccesses in half-open", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 10, halfOpenSuccesses: 2 });
    cb.onFailure();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(cb.getStatus().state, "half-open");
    cb.onSuccess();
    assert.equal(cb.getStatus().state, "half-open");
    cb.onSuccess();
    assert.equal(cb.getStatus().state, "closed");
  });

  it("riapre su fallimento in half-open", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 10 });
    cb.onFailure();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(cb.getStatus().state, "half-open");
    cb.onFailure();
    assert.equal(cb.getStatus().state, "open");
  });

  it("execute() ritorna il risultato su successo", async () => {
    const cb = new CircuitBreaker();
    const result = await cb.execute(() => Promise.resolve(42));
    assert.equal(result, 42);
    assert.equal(cb.getStatus().failures, 0);
  });

  it("execute() registra il fallimento e rilancia", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 5 });
    await assert.rejects(() => cb.execute(() => Promise.reject(new Error("boom"))));
    assert.equal(cb.getStatus().failures, 1);
  });

  it("reset() forza lo stato closed", () => {
    const cb = new CircuitBreaker({ failureThreshold: 1 });
    cb.onFailure();
    assert.equal(cb.getStatus().state, "open");
    cb.reset();
    assert.equal(cb.getStatus().state, "closed");
    assert.equal(cb.getStatus().failures, 0);
  });
});

// ── retryAsync (shared/retry) ──────────────────────────────

describe("retryAsync (retry module)", () => {
  it("ritorna al primo tentativo", async () => {
    const result = await retryAsync(() => Promise.resolve("ok"));
    assert.equal(result, "ok");
  });

  it("ritenta e riesce", async () => {
    let calls = 0;
    const result = await retryAsync(() => {
      calls++;
      if (calls < 3) throw new Error("fail");
      return Promise.resolve("ok");
    }, { attempts: 3, minDelayMs: 1, maxDelayMs: 1 });
    assert.equal(result, "ok");
  });

  it("lancia dopo tentativi esauriti", async () => {
    await assert.rejects(
      () => retryAsync(() => { throw new Error("nope"); }, { attempts: 2, minDelayMs: 1, maxDelayMs: 1 }),
      { message: "nope" },
    );
  });
});

// ── computeBackoff ─────────────────────────────────────────

describe("computeBackoff", () => {
  it("raddoppia ad ogni tentativo", () => {
    assert.equal(computeBackoff(100, 10_000, 1), 100);
    assert.equal(computeBackoff(100, 10_000, 2), 200);
    assert.equal(computeBackoff(100, 10_000, 3), 400);
  });

  it("non supera maxDelayMs", () => {
    assert.equal(computeBackoff(100, 500, 10), 500);
  });
});

// ── isTransientError ───────────────────────────────────────

describe("isTransientError", () => {
  it("rileva errori transient comuni", () => {
    assert.equal(isTransientError(new Error("429 Too Many Requests")), true);
    assert.equal(isTransientError(new Error("ECONNREFUSED")), true);
    assert.equal(isTransientError(new Error("timeout exceeded")), true);
    assert.equal(isTransientError(new Error("service unavailable")), true);
  });

  it("non rileva errori non-transient", () => {
    assert.equal(isTransientError(new Error("invalid input")), false);
    assert.equal(isTransientError(null), false);
  });
});

// ── Defaults ───────────────────────────────────────────────

describe("defaults", () => {
  it("DEFAULT_RETRY_CONFIG ha valori ragionevoli", () => {
    assert.equal(DEFAULT_RETRY_CONFIG.attempts, 3);
    assert.equal(DEFAULT_RETRY_CONFIG.minDelayMs, 300);
    assert.ok(DEFAULT_RETRY_CONFIG.maxDelayMs >= DEFAULT_RETRY_CONFIG.minDelayMs);
  });

  it("DEFAULT_CIRCUIT_CONFIG ha valori ragionevoli", () => {
    assert.equal(DEFAULT_CIRCUIT_CONFIG.failureThreshold, 5);
    assert.ok(DEFAULT_CIRCUIT_CONFIG.resetTimeoutMs > 0);
    assert.ok(DEFAULT_CIRCUIT_CONFIG.halfOpenSuccesses >= 1);
  });
});
