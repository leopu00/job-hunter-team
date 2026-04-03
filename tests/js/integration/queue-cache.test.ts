/**
 * Test integrazione — Queue + Cache
 *
 * Deduplicazione job via cache, caching risultati,
 * invalidazione su failure, stats combinate.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { JobQueue } from "../../../shared/queue/job-queue.js";
import { LRUCache } from "../../../shared/cache/lru-cache.js";
import type { JobRecord, QueueEvent } from "../../../shared/queue/types.js";

let queue: JobQueue;
let cache: LRUCache<unknown>;

beforeEach(() => {
  queue = new JobQueue({ concurrency: 1, retryPolicy: { maxAttempts: 2, initialDelayMs: 1, maxDelayMs: 5, factor: 1, jitter: 0 } });
  cache = new LRUCache({ maxEntries: 50, defaultTTL: 0 });
});

function wait(ms = 20): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

describe("Deduplicazione job via cache", () => {
  it("cache hit evita enqueue duplicato", async () => {
    queue.registerHandler("fetch", async (p: { url: string }) => `result-${p.url}`);
    const key = "fetch:example.com";
    cache.set(key, "cached-result");
    // Simula dedup: controlla cache prima di enqueue
    const cached = cache.get(key);
    expect(cached).toBe("cached-result");
    // Non enqueue perche' gia' in cache
    expect(queue.getStats().queued).toBe(0);
  });

  it("cache miss permette enqueue e processamento", async () => {
    queue.registerHandler("fetch", async (p: { url: string }) => `data-${p.url}`);
    const key = "fetch:api.test";
    expect(cache.has(key)).toBe(false);
    const job = queue.enqueue("fetch", { url: "api.test" });
    await wait();
    expect(job.status).toBe("succeeded");
  });

  it("stesso payload con chiave cache diversa viene processato", async () => {
    let count = 0;
    queue.registerHandler("process", async () => { count++; return "ok"; });
    cache.set("process:v1", "old");
    // v1 in cache, v2 no
    if (!cache.has("process:v2")) queue.enqueue("process", { v: 2 });
    await wait();
    expect(count).toBe(1);
  });
});

describe("Caching risultati job", () => {
  it("risultato job salvato in cache dopo successo", async () => {
    queue.registerHandler("compute", async (p: { n: number }) => p.n * 2);
    queue.on((e) => {
      if (e.kind === "succeeded") cache.set(`compute:${e.job.payload.n}`, e.job.result);
    });
    queue.enqueue("compute", { n: 21 });
    await wait();
    expect(cache.get("compute:21")).toBe(42);
  });

  it("risultati multipli job cachati correttamente", async () => {
    queue.registerHandler("square", async (p: { x: number }) => p.x ** 2);
    queue.on((e) => {
      if (e.kind === "succeeded") cache.set(`sq:${e.job.payload.x}`, e.job.result);
    });
    queue.enqueue("square", { x: 3 });
    queue.enqueue("square", { x: 5 });
    await wait();
    expect(cache.get("sq:3")).toBe(9);
    expect(cache.get("sq:5")).toBe(25);
  });

  it("cache con TTL: risultato scade e job va riprocessato", async () => {
    const ttlCache = new LRUCache<number>({ maxEntries: 10, defaultTTL: 50 });
    let runs = 0;
    queue.registerHandler("ephemeral", async () => { runs++; return runs; });
    queue.on((e) => {
      if (e.kind === "succeeded") ttlCache.set(`eph:1`, e.job.result as number);
    });
    queue.enqueue("ephemeral", {});
    await wait();
    expect(ttlCache.get("eph:1")).toBe(1);
    // Aspetta scadenza TTL
    await new Promise((r) => setTimeout(r, 60));
    expect(ttlCache.has("eph:1")).toBe(false);
    // Re-enqueue dopo scadenza
    queue.enqueue("ephemeral", {});
    await wait();
    expect(runs).toBe(2);
  });
});

describe("Invalidazione cache su failure", () => {
  it("cache entry rimossa quando job fallisce permanentemente (dead)", async () => {
    cache.set("data:key1", "stale-value");
    let attempt = 0;
    queue.registerHandler("unstable", async () => { attempt++; throw new Error("fail"); });
    queue.on((e) => {
      if (e.kind === "dead") cache.delete(`data:${e.job.payload.key}`);
    });
    queue.enqueue("unstable", { key: "key1" });
    await wait(100);
    expect(cache.has("data:key1")).toBe(false);
  });

  it("cache NON invalidata su retry (solo su dead)", async () => {
    cache.set("data:key2", "valid");
    let attempt = 0;
    queue.registerHandler("flaky", async () => {
      attempt++;
      if (attempt < 2) throw new Error("transient");
      return "ok";
    });
    queue.on((e) => {
      if (e.kind === "dead") cache.delete(`data:key2`);
      if (e.kind === "succeeded") cache.set(`data:key2`, e.job.result);
    });
    queue.enqueue("flaky", { key: "key2" });
    await wait(100);
    expect(cache.get("data:key2")).toBe("ok");
  });

  it("invalidateByPrefix rimuove tutti i risultati di un tipo job", async () => {
    cache.set("api:users", "data1");
    cache.set("api:posts", "data2");
    cache.set("other:x", "data3");
    // Simula invalidazione batch dopo errore API
    const removed = cache.invalidateByPrefix("api:");
    expect(removed).toBe(2);
    expect(cache.has("other:x")).toBe(true);
  });
});

describe("Stats combinate queue + cache", () => {
  it("cache stats riflettono accessi dedup", async () => {
    queue.registerHandler("work", async (p: { id: string }) => `done-${p.id}`);
    queue.on((e) => {
      if (e.kind === "succeeded") cache.set(`work:${e.job.payload.id}`, e.job.result);
    });
    queue.enqueue("work", { id: "a" });
    await wait();
    // Accesso da cache (dedup hit)
    cache.get("work:a");
    cache.get("work:a");
    cache.get("work:b"); // miss
    const cs = cache.stats();
    expect(cs.hits).toBe(2);
    expect(cs.misses).toBe(1);
    const qs = queue.getStats();
    expect(qs.succeeded).toBe(1);
  });

  it("LRU eviction di risultati job quando cache piena", () => {
    const smallCache = new LRUCache<string>({ maxEntries: 3, defaultTTL: 0 });
    smallCache.set("job:1", "r1");
    smallCache.set("job:2", "r2");
    smallCache.set("job:3", "r3");
    smallCache.set("job:4", "r4"); // evict job:1
    expect(smallCache.has("job:1")).toBe(false);
    expect(smallCache.has("job:4")).toBe(true);
    expect(smallCache.stats().evictions).toBe(1);
  });
});

