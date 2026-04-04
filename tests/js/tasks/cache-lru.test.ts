/**
 * Test unitari — shared/cache LRU con TTL, invalidazione, stats
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { LRUCache } from "../../../shared/cache/lru-cache.js";
import type { EvictReason } from "../../../shared/cache/types.js";

describe("LRUCache — operazioni base", () => {
  let cache: LRUCache<string>;
  beforeEach(() => { cache = new LRUCache({ maxEntries: 5, defaultTTL: 0 }); });

  it("set + get memorizza e recupera valore", () => {
    cache.set("a", "alfa");
    expect(cache.get("a")).toBe("alfa");
  });

  it("get ritorna undefined per chiave inesistente", () => {
    expect(cache.get("nope")).toBeUndefined();
  });

  it("has ritorna true/false correttamente", () => {
    cache.set("x", "val");
    expect(cache.has("x")).toBe(true);
    expect(cache.has("y")).toBe(false);
  });

  it("delete rimuove entry", () => {
    cache.set("a", "alfa");
    expect(cache.delete("a")).toBe(true);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.delete("a")).toBe(false);
  });

  it("size traccia conteggio entry", () => {
    expect(cache.size).toBe(0);
    cache.set("a", "1");
    cache.set("b", "2");
    expect(cache.size).toBe(2);
    cache.delete("a");
    expect(cache.size).toBe(1);
  });

  it("keys ritorna tutte le chiavi", () => {
    cache.set("x", "1");
    cache.set("y", "2");
    expect(cache.keys()).toContain("x");
    expect(cache.keys()).toContain("y");
    expect(cache.keys()).toHaveLength(2);
  });

  it("clear svuota tutta la cache", () => {
    cache.set("a", "1");
    cache.set("b", "2");
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get("a")).toBeUndefined();
  });

  it("set sovrascrive valore esistente", () => {
    cache.set("a", "v1");
    cache.set("a", "v2");
    expect(cache.get("a")).toBe("v2");
    expect(cache.size).toBe(1);
  });
});

describe("LRUCache — TTL scadenza", () => {
  it("entry scade dopo defaultTTL", () => {
    vi.useFakeTimers();
    const cache = new LRUCache<string>({ defaultTTL: 100 });
    cache.set("a", "val");
    expect(cache.get("a")).toBe("val");
    vi.advanceTimersByTime(150);
    expect(cache.get("a")).toBeUndefined();
    vi.useRealTimers();
  });

  it("TTL custom per singola entry sovrascrive default", () => {
    vi.useFakeTimers();
    const cache = new LRUCache<string>({ defaultTTL: 1000 });
    cache.set("short", "val", { ttl: 50 });
    cache.set("long", "val2");
    vi.advanceTimersByTime(100);
    expect(cache.get("short")).toBeUndefined();
    expect(cache.get("long")).toBe("val2");
    vi.useRealTimers();
  });

  it("TTL 0 significa nessuna scadenza", () => {
    vi.useFakeTimers();
    const cache = new LRUCache<string>({ defaultTTL: 0 });
    cache.set("forever", "val");
    vi.advanceTimersByTime(999999);
    expect(cache.get("forever")).toBe("val");
    vi.useRealTimers();
  });

  it("has ritorna false per entry scaduta", () => {
    vi.useFakeTimers();
    const cache = new LRUCache<string>({ defaultTTL: 50 });
    cache.set("temp", "val");
    vi.advanceTimersByTime(60);
    expect(cache.has("temp")).toBe(false);
    vi.useRealTimers();
  });

  it("purgeExpired rimuove tutte le entry scadute", () => {
    vi.useFakeTimers();
    const cache = new LRUCache<string>({ defaultTTL: 100 });
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3", { ttl: 500 });
    vi.advanceTimersByTime(150);
    const purged = cache.purgeExpired();
    expect(purged).toBe(2);
    expect(cache.size).toBe(1);
    expect(cache.get("c")).toBe("3");
    vi.useRealTimers();
  });
});

describe("LRUCache — LRU eviction", () => {
  it("evict LRU quando maxEntries raggiunto", () => {
    const cache = new LRUCache<string>({ maxEntries: 3, defaultTTL: 0 });
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3");
    cache.set("d", "4");
    expect(cache.size).toBe(3);
    expect(cache.has("a")).toBe(false);
    expect(cache.has("d")).toBe(true);
  });

  it("get promuove entry a piu' recente (evita eviction)", () => {
    const cache = new LRUCache<string>({ maxEntries: 3, defaultTTL: 0 });
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3");
    cache.get("a"); // promuove "a"
    cache.set("d", "4"); // evict "b" (il meno recente ora)
    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
  });

  it("set su chiave esistente la promuove", () => {
    const cache = new LRUCache<string>({ maxEntries: 3, defaultTTL: 0 });
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3");
    cache.set("a", "updated"); // promuove "a"
    cache.set("d", "4"); // evict "b"
    expect(cache.get("a")).toBe("updated");
    expect(cache.has("b")).toBe(false);
  });
});

describe("LRUCache — invalidazione", () => {
  let cache: LRUCache<string>;
  beforeEach(() => {
    cache = new LRUCache({ maxEntries: 100, defaultTTL: 0 });
    cache.set("user:1", "alice");
    cache.set("user:2", "bob");
    cache.set("session:1", "s1");
    cache.set("session:2", "s2");
  });

  it("invalidateByPrefix rimuove chiavi con prefisso", () => {
    const removed = cache.invalidateByPrefix("user:");
    expect(removed).toBe(2);
    expect(cache.has("user:1")).toBe(false);
    expect(cache.has("session:1")).toBe(true);
  });

  it("invalidateByPattern rimuove chiavi che matchano regex", () => {
    const removed = cache.invalidateByPattern(/session:\d+/);
    expect(removed).toBe(2);
    expect(cache.has("session:1")).toBe(false);
    expect(cache.has("user:1")).toBe(true);
  });

  it("invalidateByPrefix ritorna 0 se nessun match", () => {
    expect(cache.invalidateByPrefix("nonexistent:")).toBe(0);
  });

  it("invalidateByPattern ritorna 0 se nessun match", () => {
    expect(cache.invalidateByPattern(/^zzz/)).toBe(0);
  });
});

describe("LRUCache — stats e callback", () => {
  it("stats traccia hits, misses, hitRate", () => {
    const cache = new LRUCache<string>({ maxEntries: 10, defaultTTL: 0 });
    cache.set("a", "1");
    cache.get("a"); // hit
    cache.get("a"); // hit
    cache.get("b"); // miss
    const s = cache.stats();
    expect(s.hits).toBe(2);
    expect(s.misses).toBe(1);
    expect(s.hitRate).toBeCloseTo(2 / 3);
  });

  it("evictions conteggiate nelle stats", () => {
    const cache = new LRUCache<string>({ maxEntries: 2, defaultTTL: 0 });
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3"); // evict a
    expect(cache.stats().evictions).toBe(1);
  });

  it("resetStats azzera contatori", () => {
    const cache = new LRUCache<string>({ maxEntries: 10, defaultTTL: 0 });
    cache.set("a", "1");
    cache.get("a");
    cache.get("z");
    cache.resetStats();
    const s = cache.stats();
    expect(s.hits).toBe(0);
    expect(s.misses).toBe(0);
    expect(s.hitRate).toBe(0);
  });

  it("onEvict callback invocata con reason corretta", () => {
    const evicted: Array<{ key: string; reason: EvictReason }> = [];
    const cache = new LRUCache<string>({
      maxEntries: 2, defaultTTL: 0,
      onEvict: (key, reason) => evicted.push({ key, reason }),
    });
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3"); // evict "a" -> lru
    cache.delete("b");   // manual
    cache.clear();        // clear "c"
    expect(evicted).toEqual([
      { key: "a", reason: "lru" },
      { key: "b", reason: "manual" },
      { key: "c", reason: "clear" },
    ]);
  });

  it("set con size option memorizza dimensione", () => {
    const cache = new LRUCache<string>({ defaultTTL: 0 });
    cache.set("big", "data", { size: 1024 });
    cache.get("big");
    expect(cache.size).toBe(1);
  });
});
