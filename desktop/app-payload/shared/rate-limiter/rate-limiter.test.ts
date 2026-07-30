import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createFixedWindowRateLimiter } from "./fixed-window.js";
import { resolveRetryConfig, retryAsync } from "./retry.js";
import { createProviderRetryRunner, API_RETRY_DEFAULTS } from "./provider-retry.js";

// ── Fixed Window Rate Limiter ──────────────────────────────

describe("createFixedWindowRateLimiter", () => {
  it("permette richieste entro il limite", () => {
    const limiter = createFixedWindowRateLimiter({ maxRequests: 3, windowMs: 1000, now: () => 100 });
    const r1 = limiter.consume();
    assert.equal(r1.allowed, true);
    assert.equal(r1.remaining, 2);
    assert.equal(r1.retryAfterMs, 0);
  });

  it("blocca dopo maxRequests esaurite", () => {
    let t = 100;
    const limiter = createFixedWindowRateLimiter({ maxRequests: 2, windowMs: 1000, now: () => t });
    limiter.consume();
    limiter.consume();
    const r3 = limiter.consume();
    assert.equal(r3.allowed, false);
    assert.equal(r3.remaining, 0);
    assert.ok(r3.retryAfterMs > 0);
  });

  it("remaining decresce ad ogni consume", () => {
    const limiter = createFixedWindowRateLimiter({ maxRequests: 4, windowMs: 1000, now: () => 0 });
    assert.equal(limiter.consume().remaining, 3);
    assert.equal(limiter.consume().remaining, 2);
    assert.equal(limiter.consume().remaining, 1);
    assert.equal(limiter.consume().remaining, 0);
  });

  it("retryAfterMs indica il tempo restante della finestra", () => {
    let t = 0;
    const limiter = createFixedWindowRateLimiter({ maxRequests: 1, windowMs: 1000, now: () => t });
    limiter.consume();
    t = 300;
    const blocked = limiter.consume();
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.retryAfterMs, 700);
  });

  it("resetta la finestra dopo windowMs", () => {
    let t = 0;
    const limiter = createFixedWindowRateLimiter({ maxRequests: 1, windowMs: 100, now: () => t });
    limiter.consume();
    assert.equal(limiter.consume().allowed, false);
    t = 100;
    const after = limiter.consume();
    assert.equal(after.allowed, true);
    assert.equal(after.remaining, 0);
  });

  it("reset() azzera contatore e finestra", () => {
    const limiter = createFixedWindowRateLimiter({ maxRequests: 1, windowMs: 1000, now: () => 50 });
    limiter.consume();
    assert.equal(limiter.consume().allowed, false);
    limiter.reset();
    assert.equal(limiter.consume().allowed, true);
  });
});

// ── resolveRetryConfig ─────────────────────────────────────

describe("resolveRetryConfig", () => {
  it("ritorna i default senza overrides", () => {
    const cfg = resolveRetryConfig();
    assert.equal(cfg.attempts, 3);
    assert.equal(cfg.minDelayMs, 300);
    assert.equal(cfg.maxDelayMs, 30_000);
    assert.equal(cfg.jitter, 0);
  });

  it("applica overrides e clampa valori invalidi", () => {
    const cfg = resolveRetryConfig(undefined, { attempts: -5, jitter: 2 });
    assert.equal(cfg.attempts, 1);
    assert.equal(cfg.jitter, 1);
  });

  it("maxDelayMs non scende sotto minDelayMs", () => {
    const cfg = resolveRetryConfig(undefined, { minDelayMs: 5000, maxDelayMs: 100 });
    assert.ok(cfg.maxDelayMs >= cfg.minDelayMs);
  });
});

// ── retryAsync ─────────────────────────────────────────────

describe("retryAsync", () => {
  it("ritorna il risultato al primo tentativo", async () => {
    const result = await retryAsync(() => Promise.resolve("ok"), 1);
    assert.equal(result, "ok");
  });

  it("ritenta e riesce al secondo tentativo", async () => {
    let calls = 0;
    const result = await retryAsync(() => {
      calls++;
      if (calls < 2) throw new Error("fail");
      return Promise.resolve("recovered");
    }, { attempts: 3, minDelayMs: 1, maxDelayMs: 1 });
    assert.equal(result, "recovered");
    assert.equal(calls, 2);
  });

  it("lancia dopo tentativi esauriti (forma numerica)", async () => {
    let calls = 0;
    await assert.rejects(
      () => retryAsync(() => { calls++; throw new Error("always"); }, 2, 1),
      { message: "always" },
    );
    assert.equal(calls, 2);
  });

  it("rispetta shouldRetry — non ritenta se false", async () => {
    let calls = 0;
    await assert.rejects(
      () => retryAsync(() => { calls++; throw new Error("stop"); }, {
        attempts: 5,
        minDelayMs: 1,
        shouldRetry: () => false,
      }),
    );
    assert.equal(calls, 1);
  });

  it("invoca onRetry callback", async () => {
    const retries: number[] = [];
    let calls = 0;
    await assert.rejects(
      () => retryAsync(() => { calls++; throw new Error("err"); }, {
        attempts: 3,
        minDelayMs: 1,
        maxDelayMs: 1,
        onRetry: (info) => retries.push(info.attempt),
      }),
    );
    assert.deepEqual(retries, [1, 2]);
  });
});

// ── createProviderRetryRunner ──────────────────────────────

describe("createProviderRetryRunner", () => {
  it("crea un runner che esegue la funzione", async () => {
    const runner = createProviderRetryRunner({
      retry: { attempts: 1, minDelayMs: 1 },
    });
    const result = await runner(() => Promise.resolve(42), "test");
    assert.equal(result, 42);
  });

  it("runner ritenta errori 429", async () => {
    let calls = 0;
    const runner = createProviderRetryRunner({
      retry: { attempts: 3, minDelayMs: 1, maxDelayMs: 1 },
      onRetry: () => {},
    });
    const result = await runner(() => {
      calls++;
      if (calls < 2) throw new Error("429 Too Many Requests");
      return Promise.resolve("done");
    }, "api-call");
    assert.equal(result, "done");
    assert.equal(calls, 2);
  });

  it("API_RETRY_DEFAULTS ha valori sensati", () => {
    assert.equal(API_RETRY_DEFAULTS.attempts, 3);
    assert.equal(API_RETRY_DEFAULTS.minDelayMs, 500);
    assert.ok(API_RETRY_DEFAULTS.jitter > 0);
  });
});
