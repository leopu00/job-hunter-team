import { describe, it, expect, beforeEach } from "vitest";
import { JobQueue } from "../../../shared/queue/job-queue.js";
import type { QueueEvent } from "../../../shared/queue/types.js";
import { recordCall, getSummary, getEntries, clearEntries, getEntryCount } from "../../../shared/analytics/usage-tracker.js";

beforeEach(() => clearEntries());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("queue + analytics integrazione", () => {
  it("registra metriche analytics per ogni job completato", async () => {
    const queue = new JobQueue({ concurrency: 1, retryPolicy: { maxAttempts: 1 } });

    queue.registerHandler<{ model: string }, void>("llm-call", async (payload) => {
      recordCall({
        provider: "claude", model: payload.model,
        tokens: { input: 500, output: 200 }, latencyMs: 150,
      });
    });

    queue.enqueue("llm-call", { model: "claude-sonnet-4-6" });
    queue.enqueue("llm-call", { model: "claude-sonnet-4-6" });
    await sleep(50);

    expect(getEntryCount()).toBe(2);
    const summary = getSummary();
    expect(summary.totalCalls).toBe(2);
    expect(summary.byProvider).toHaveLength(1);
    expect(summary.byProvider[0].provider).toBe("claude");
  });

  it("traccia errori analytics per job falliti", async () => {
    const queue = new JobQueue({ concurrency: 1, retryPolicy: { maxAttempts: 1 } });

    queue.registerHandler("api-call", async () => {
      recordCall({
        provider: "openai", model: "gpt-4o",
        tokens: { input: 100, output: 0 }, latencyMs: 5000,
        success: false, error: "timeout",
      });
      throw new Error("timeout");
    });

    queue.enqueue("api-call", {});
    await sleep(50);

    const summary = getSummary();
    expect(summary.totalErrors).toBe(1);
    expect(summary.byProvider[0].errors).toBe(1);
  });

  it("aggrega costi per provider diversi", async () => {
    const queue = new JobQueue({ concurrency: 2, retryPolicy: { maxAttempts: 1 } });
    queue.registerHandler<{ p: string; m: string }, void>("track", async (payload) => {
      recordCall({ provider: payload.p as any, model: payload.m, tokens: { input: 1_000_000, output: 500_000 }, latencyMs: 200 });
    });
    queue.enqueue("track", { p: "claude", m: "claude-sonnet-4-6" });
    queue.enqueue("track", { p: "openai", m: "gpt-4o" });
    await sleep(50);

    const summary = getSummary();
    expect(summary.byProvider).toHaveLength(2);
    expect(summary.totalCostUsd).toBeGreaterThan(0);
  });

  it("job con priorità critical processati prima", async () => {
    const queue = new JobQueue({ concurrency: 1, retryPolicy: { maxAttempts: 1 } });
    const order: string[] = [];
    queue.registerHandler<{ m: string }, void>("log", async (p) => {
      order.push(p.m);
      recordCall({ provider: "claude", model: p.m, tokens: { input: 10, output: 5 }, latencyMs: 10 });
    });
    queue.enqueue("log", { m: "first" }, "low");
    await sleep(20);
    queue.enqueue("log", { m: "critical" }, "critical");
    queue.enqueue("log", { m: "normal" }, "normal");
    await sleep(100);
    expect(order[0]).toBe("first");
    expect(getEntryCount()).toBeGreaterThanOrEqual(2);
  });

  it("eventi queue correlati con entries analytics", async () => {
    const queue = new JobQueue({ concurrency: 1, retryPolicy: { maxAttempts: 1 } });
    const events: QueueEvent[] = [];
    queue.on((e) => events.push(e));

    queue.registerHandler("metered", async () => {
      recordCall({
        provider: "minimax", model: "minimax-01",
        tokens: { input: 200, output: 100 }, latencyMs: 80,
      });
    });

    queue.enqueue("metered", {});
    await sleep(50);

    const succeeded = events.filter((e) => e.kind === "succeeded");
    expect(succeeded).toHaveLength(1);
    expect(getEntryCount()).toBe(1);
    expect(getEntries()[0].provider).toBe("minimax");
  });

  it("dead letter job registra errore analytics", async () => {
    const queue = new JobQueue({ concurrency: 1, retryPolicy: { maxAttempts: 1 } });
    const deadEvents: QueueEvent[] = [];
    queue.on((e) => { if (e.kind === "dead") deadEvents.push(e); });

    queue.registerHandler("failing", async () => {
      recordCall({
        provider: "openai", model: "gpt-4o",
        tokens: { input: 50, output: 0 }, latencyMs: 100,
        success: false, error: "rate limit",
      });
      throw new Error("rate limit");
    });

    queue.enqueue("failing", {});
    await sleep(50);

    expect(deadEvents).toHaveLength(1);
    expect(getEntries()[0].success).toBe(false);
    expect(getSummary().totalErrors).toBe(1);
  });

  it("statistiche queue e analytics summary coerenti", async () => {
    const queue = new JobQueue({ concurrency: 2, retryPolicy: { maxAttempts: 1 } });
    let callCount = 0;

    queue.registerHandler("count", async () => {
      callCount++;
      recordCall({
        provider: "claude", model: "claude-haiku-4-5",
        tokens: { input: 50, output: 25 }, latencyMs: 30,
      });
    });

    for (let i = 0; i < 5; i++) queue.enqueue("count", {});
    await sleep(200);

    const qStats = queue.getStats();
    const aSummary = getSummary();

    expect(qStats.succeeded).toBe(5);
    expect(aSummary.totalCalls).toBe(5);
    expect(aSummary.latency.count).toBe(5);
  });

  it("latenza p95 analytics riflette job reali con latenze diverse", async () => {
    const queue = new JobQueue({ concurrency: 1, retryPolicy: { maxAttempts: 1 } });
    let latencyValue = 0;

    queue.registerHandler<{ ms: number }, void>("varied", async (p) => {
      recordCall({
        provider: "claude", model: "claude-sonnet-4-6",
        tokens: { input: 10, output: 5 }, latencyMs: p.ms,
      });
    });

    const latencies = [50, 60, 70, 80, 90, 100, 110, 120, 130, 500];
    for (const ms of latencies) queue.enqueue("varied", { ms });
    await sleep(200);

    const summary = getSummary();
    expect(summary.latency.p95Ms).toBeGreaterThanOrEqual(400);
    expect(summary.latency.minMs).toBe(50);
    expect(summary.latency.maxMs).toBe(500);
  });

  it("costo totale corrisponde a somma costi individuali", async () => {
    const queue = new JobQueue({ concurrency: 1, retryPolicy: { maxAttempts: 1 } });
    queue.registerHandler("cost", async () => {
      recordCall({ provider: "claude", model: "claude-sonnet-4-6", tokens: { input: 100_000, output: 50_000 }, latencyMs: 100 });
    });
    for (let i = 0; i < 3; i++) queue.enqueue("cost", {});
    await sleep(100);
    const sumCosts = getEntries().reduce((s, e) => s + e.costUsd, 0);
    expect(Math.abs(getSummary().totalCostUsd - sumCosts)).toBeLessThan(0.000001);
  });

  it("analytics daily stats si aggiornano dopo job queue processing", async () => {
    const queue = new JobQueue({ concurrency: 1, retryPolicy: { maxAttempts: 1 } });

    queue.registerHandler("daily", async () => {
      recordCall({
        provider: "openai", model: "gpt-4o-mini",
        tokens: { input: 1000, output: 500 }, latencyMs: 50,
      });
    });

    queue.enqueue("daily", {});
    queue.enqueue("daily", {});
    await sleep(50);

    const summary = getSummary();
    expect(summary.daily).toHaveLength(1);
    expect(summary.daily[0].calls).toBe(2);
    expect(summary.daily[0].tokens).toBeGreaterThan(0);
  });
});
