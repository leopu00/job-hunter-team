/** Test integrazione — shared/queue + shared/retry (vitest): retry backoff, circuit breaker, dead-letter. */
import { describe, it, expect, beforeEach } from "vitest";
import { JobQueue } from "../../../shared/queue/job-queue.js";
import { CircuitBreaker, CircuitBreakerOpenError } from "../../../shared/retry/circuit-breaker.js";
import { resolveRetryConfig, computeBackoff, isTransientError, createRetryRunner } from "../../../shared/retry/retry.js";
import { DEFAULT_RETRY_CONFIG, DEFAULT_CIRCUIT_CONFIG } from "../../../shared/retry/types.js";
import type { QueueEvent } from "../../../shared/queue/types.js";

const FAST_RETRY = { maxAttempts: 2, initialDelayMs: 1, maxDelayMs: 5, factor: 1, jitter: 0 };
function wait(ms = 50): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

// --- JobQueue: dead-letter, eventi, priority ---

describe("JobQueue — dead-letter e retry", () => {
  let q: JobQueue;
  beforeEach(() => { q = new JobQueue({ concurrency: 1, retryPolicy: FAST_RETRY }); });

  it("job fallisce tutti i tentativi e finisce in dead-letter", async () => {
    q.registerHandler("fail", async () => { throw new Error("boom"); });
    const events: string[] = [];
    q.on((e) => events.push(e.kind));
    q.enqueue("fail", {});
    await wait(100);
    expect(q.getDeadLetterJobs()).toHaveLength(1);
    expect(q.getDeadLetterJobs()[0].lastError).toContain("boom");
    expect(events).toContain("dead");
  });

  it("job fallisce una volta, retry, poi riesce", async () => {
    let count = 0;
    q.registerHandler("flaky", async () => { if (++count < 2) throw new Error("transient"); return "ok"; });
    const job = q.enqueue("flaky", {});
    await wait(100);
    expect(job.status).toBe("succeeded");
    expect(count).toBe(2);
  });

  it("retryDeadJob rimette job in coda e riparte", async () => {
    let count = 0;
    q.registerHandler("recover", async () => { if (++count <= 2) throw new Error("fail"); return "ok"; });
    q.enqueue("recover", {});
    await wait(100);
    const dead = q.getDeadLetterJobs();
    expect(dead).toHaveLength(1);
    q.retryDeadJob(dead[0].id);
    await wait(100);
    expect(q.getDeadLetterJobs()).toHaveLength(0);
  });

  it("clearDeadLetter svuota e ritorna count", async () => {
    q.registerHandler("die", async () => { throw new Error("x"); });
    q.enqueue("die", {});
    q.enqueue("die", {});
    await wait(100);
    expect(q.clearDeadLetter()).toBe(2);
    expect(q.getDeadLetterJobs()).toHaveLength(0);
  });

  it("job senza handler va direttamente in dead-letter", async () => {
    q.enqueue("no-handler", {});
    await wait();
    expect(q.getDeadLetterJobs()).toHaveLength(1);
    expect(q.getDeadLetterJobs()[0].lastError).toContain("Nessun handler");
  });

  it("priority critical processato prima di low", async () => {
    const order: string[] = [];
    const sq = new JobQueue({ concurrency: 1, retryPolicy: { ...FAST_RETRY, maxAttempts: 1 } });
    sq.registerHandler("pri", async (p: { id: string }) => {
      await new Promise(r => setTimeout(r, 10));
      order.push(p.id);
    });
    sq.enqueue("pri", { id: "first" });
    sq.enqueue("pri", { id: "low" }, "low");
    sq.enqueue("pri", { id: "crit" }, "critical");
    await wait(100);
    expect(order).toEqual(["first", "crit", "low"]);
  });

  it("stats riflettono tutti gli stati", async () => {
    q.registerHandler("ok", async () => "done");
    q.registerHandler("nope", async () => { throw new Error("x"); });
    q.enqueue("ok", {});
    q.enqueue("nope", {});
    await wait(100);
    const s = q.getStats();
    expect(s.succeeded).toBe(1);
    expect(s.dead).toBe(1);
    expect(s.totalProcessed).toBe(2);
  });
});

// --- CircuitBreaker ---

describe("CircuitBreaker — state transitions", () => {
  it("closed → open dopo failureThreshold errori", () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 100 });
    for (let i = 0; i < 3; i++) cb.onFailure();
    expect(cb.getStatus().state).toBe("open");
  });

  it("open lancia CircuitBreakerOpenError", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 10000 });
    cb.onFailure();
    await expect(cb.execute(async () => "x")).rejects.toThrow(CircuitBreakerOpenError);
  });

  it("isCallPermitted false quando open, true quando closed", () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 10000 });
    expect(cb.isCallPermitted()).toBe(true);
    cb.onFailure();
    expect(cb.isCallPermitted()).toBe(false);
  });

  it("open → half-open dopo resetTimeout", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 30 });
    cb.onFailure();
    expect(cb.getStatus().state).toBe("open");
    await wait(50);
    expect(cb.getStatus().state).toBe("half-open");
  });

  it("successo in half-open chiude il circuito", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 20, halfOpenSuccesses: 1 });
    cb.onFailure();
    await wait(30);
    expect(cb.getStatus().state).toBe("half-open"); // checkState triggers transition
    cb.onSuccess();
    expect(cb.getStatus().state).toBe("closed");
  });

  it("fallimento in half-open riapre il circuito", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 20 });
    cb.onFailure();
    await wait(30);
    expect(cb.getStatus().state).toBe("half-open"); // checkState triggers transition
    cb.onFailure();
    expect(cb.getStatus().state).toBe("open");
  });

  it("reset forza closed da qualsiasi stato", () => {
    const cb = new CircuitBreaker({ failureThreshold: 1 });
    cb.onFailure();
    expect(cb.getStatus().state).toBe("open");
    cb.reset();
    expect(cb.getStatus().state).toBe("closed");
    expect(cb.getStatus().failures).toBe(0);
  });
});

// --- shared/retry helpers ---

describe("retry helpers — config e backoff", () => {
  it("resolveRetryConfig clamp attempts >= 1 e jitter 0-1", () => {
    const c = resolveRetryConfig(DEFAULT_RETRY_CONFIG, { attempts: -5, jitter: 2 });
    expect(c.attempts).toBeGreaterThanOrEqual(1);
    expect(c.jitter).toBeLessThanOrEqual(1);
  });

  it("computeBackoff esponenziale capped a maxDelayMs", () => {
    expect(computeBackoff(100, 1000, 1)).toBe(100);
    expect(computeBackoff(100, 1000, 4)).toBe(800);
    expect(computeBackoff(100, 1000, 10)).toBe(1000);
  });

  it("isTransientError rileva 429, timeout, ECONNREFUSED", () => {
    expect(isTransientError(new Error("429 Too Many Requests"))).toBe(true);
    expect(isTransientError(new Error("ECONNREFUSED"))).toBe(true);
    expect(isTransientError(new Error("timeout"))).toBe(true);
    expect(isTransientError(new Error("syntax error"))).toBe(false);
  });

  it("DEFAULT configs hanno valori attesi", () => {
    expect(DEFAULT_RETRY_CONFIG.attempts).toBe(3);
    expect(DEFAULT_CIRCUIT_CONFIG.failureThreshold).toBe(5);
    expect(DEFAULT_CIRCUIT_CONFIG.resetTimeoutMs).toBe(30000);
  });
});

// --- Integrazione queue + circuit breaker ---

describe("Queue + CircuitBreaker — integrazione", () => {
  it("circuit breaker aperto blocca esecuzione handler nel job", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 10000 });
    cb.onFailure(); // apri circuito
    const q = new JobQueue({ concurrency: 1, retryPolicy: { ...FAST_RETRY, maxAttempts: 1 } });
    q.registerHandler("guarded", async () => {
      return await cb.execute(async () => "result");
    });
    const events: QueueEvent[] = [];
    q.on((e) => events.push(e));
    q.enqueue("guarded", {});
    await wait();
    expect(events.some(e => e.kind === "dead")).toBe(true);
    const dead = q.getDeadLetterJobs();
    expect(dead[0].lastError).toContain("Circuito aperto");
  });
});
