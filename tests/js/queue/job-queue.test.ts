/** Test unitari job-queue — priorita', concorrenza, dead-letter, eventi */

import { describe, it, expect, beforeEach } from "vitest";
import { JobQueue } from "../../../shared/queue/job-queue.js";
import type { QueueEvent } from "../../../shared/queue/types.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const FAST_RETRY = { maxAttempts: 1, initialDelayMs: 5 };
const RETRY_2 = { maxAttempts: 2, initialDelayMs: 10 };

describe("JobQueue enqueue", () => {
  it("crea un job con valori corretti e default priority normal", () => {
    const q = new JobQueue({ retryPolicy: FAST_RETRY });
    q.registerHandler("test", async () => "ok");
    const job = q.enqueue("test", { x: 1 }, "high");
    expect(job.id).toBeTruthy();
    expect(job.name).toBe("test");
    expect(job.payload).toEqual({ x: 1 });
    expect(job.priority).toBe("high");
    expect(job.createdAt).toBeGreaterThan(0);
    const job2 = q.enqueue("test", {});
    expect(job2.priority).toBe("normal");
  });
});

describe("JobQueue processing", () => {
  it("esegue handler e completa con successo", async () => {
    const q = new JobQueue({ retryPolicy: FAST_RETRY });
    const results: string[] = [];
    q.registerHandler("greet", async (p: { name: string }) => {
      results.push(p.name);
      return "done";
    });
    q.enqueue("greet", { name: "Leo" });
    await wait(50);
    expect(results).toEqual(["Leo"]);
    expect(q.getStats().succeeded).toBe(1);
  });

  it("stats riflettono stato corretto dopo completamento", async () => {
    const q = new JobQueue({ retryPolicy: FAST_RETRY });
    q.registerHandler("ok", async () => "done");
    q.enqueue("ok", {});
    q.enqueue("ok", {});
    await wait(100);
    const stats = q.getStats();
    expect(stats.succeeded).toBe(2);
    expect(stats.queued).toBe(0);
    expect(stats.running).toBe(0);
    expect(stats.totalProcessed).toBe(2);
  });
});

describe("JobQueue priority", () => {
  it("ordina pending per priorita' (critical prima di low)", () => {
    const q = new JobQueue({ concurrency: 0, retryPolicy: FAST_RETRY });
    q.enqueue("a", {}, "low");
    q.enqueue("b", {}, "critical");
    q.enqueue("c", {}, "normal");
    q.enqueue("d", {}, "high");
    const pending = q.getPendingJobs();
    const priorities = pending.map((j) => j.priority);
    expect(priorities).toEqual(["critical", "high", "normal", "low"]);
  });
});

describe("JobQueue concurrency", () => {
  it("rispetta limite di concorrenza", async () => {
    let maxConcurrent = 0;
    let running = 0;
    const q = new JobQueue({ concurrency: 2, retryPolicy: FAST_RETRY });
    q.registerHandler("slow", async () => {
      running++;
      maxConcurrent = Math.max(maxConcurrent, running);
      await wait(30);
      running--;
    });
    q.enqueue("slow", {});
    q.enqueue("slow", {});
    q.enqueue("slow", {});
    await wait(200);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
    expect(q.getStats().succeeded).toBe(3);
  });
});

describe("JobQueue dead-letter", () => {
  it("job va in dead-letter dopo maxAttempts", async () => {
    const q = new JobQueue({ retryPolicy: RETRY_2 });
    q.registerHandler("fail", async () => { throw new Error("boom"); });
    q.enqueue("fail", {});
    await wait(200);
    const dlq = q.getDeadLetterJobs();
    expect(dlq.length).toBe(1);
    expect(dlq[0].lastError).toBe("boom");
    expect(dlq[0].attempts).toBe(2);
    expect(dlq[0].status).toBe("dead");
    expect(q.getStats().dead).toBe(1);
  });

  it("job senza handler va direttamente in dead-letter", async () => {
    const q = new JobQueue({ retryPolicy: FAST_RETRY });
    q.enqueue("unknown-handler", {});
    await wait(50);
    const dlq = q.getDeadLetterJobs();
    expect(dlq.length).toBe(1);
    expect(dlq[0].lastError).toContain("Nessun handler");
  });

  it("retryDeadJob rimette in coda e riesegue", async () => {
    const q = new JobQueue({ retryPolicy: FAST_RETRY });
    let attempts = 0;
    q.registerHandler("flaky", async () => {
      attempts++;
      if (attempts < 2) throw new Error("fail");
      return "ok";
    });
    q.enqueue("flaky", {});
    await wait(50);
    expect(q.getDeadLetterJobs().length).toBe(1);
    // Ora riprova
    const jobId = q.getDeadLetterJobs()[0].id;
    expect(q.retryDeadJob(jobId)).toBe(true);
    await wait(50);
    expect(q.getDeadLetterJobs().length).toBe(0);
    expect(attempts).toBe(2);
  });

  it("retryDeadJob ritorna false per id inesistente", () => {
    const q = new JobQueue({ retryPolicy: FAST_RETRY });
    expect(q.retryDeadJob("non-esiste")).toBe(false);
  });

  it("clearDeadLetter svuota la dlq", async () => {
    const q = new JobQueue({ retryPolicy: FAST_RETRY });
    q.registerHandler("fail", async () => { throw new Error("e"); });
    q.enqueue("fail", {});
    q.enqueue("fail", {});
    await wait(100);
    expect(q.getDeadLetterJobs().length).toBe(2);
    const cleared = q.clearDeadLetter();
    expect(cleared).toBe(2);
    expect(q.getDeadLetterJobs().length).toBe(0);
  });

  it("dlq rispetta maxDeadLetterSize", async () => {
    const q = new JobQueue({ retryPolicy: FAST_RETRY, maxDeadLetterSize: 2 });
    q.registerHandler("fail", async () => { throw new Error("e"); });
    q.enqueue("fail", { n: 1 });
    q.enqueue("fail", { n: 2 });
    q.enqueue("fail", { n: 3 });
    await wait(150);
    expect(q.getDeadLetterJobs().length).toBe(2);
  });
});

describe("JobQueue events", () => {
  it("emette enqueued, started, succeeded per job riuscito", async () => {
    const q = new JobQueue({ retryPolicy: FAST_RETRY });
    q.registerHandler("ok", async () => "done");
    const events: QueueEvent["kind"][] = [];
    q.on((e) => events.push(e.kind));
    q.enqueue("ok", {});
    await wait(50);
    expect(events).toContain("enqueued");
    expect(events).toContain("started");
    expect(events).toContain("succeeded");
  });

  it("emette dead per job fallito permanentemente", async () => {
    const q = new JobQueue({ retryPolicy: FAST_RETRY });
    q.registerHandler("fail", async () => { throw new Error("x"); });
    const events: QueueEvent["kind"][] = [];
    q.on((e) => events.push(e.kind));
    q.enqueue("fail", {});
    await wait(50);
    expect(events).toContain("dead");
  });

  it("unsubscribe rimuove listener", async () => {
    const q = new JobQueue({ retryPolicy: FAST_RETRY });
    q.registerHandler("ok", async () => "done");
    const events: QueueEvent["kind"][] = [];
    const unsub = q.on((e) => events.push(e.kind));
    unsub();
    q.enqueue("ok", {});
    await wait(50);
    expect(events.length).toBe(0);
  });

  it("clear svuota tutto", async () => {
    const q = new JobQueue({ retryPolicy: FAST_RETRY });
    q.registerHandler("ok", async () => "done");
    q.enqueue("ok", {});
    await wait(50);
    q.clear();
    const stats = q.getStats();
    expect(stats.totalProcessed).toBe(0);
  });
});
