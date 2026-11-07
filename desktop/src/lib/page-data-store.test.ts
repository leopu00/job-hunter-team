import { describe, expect, it, vi } from "vitest";
import { PageDataStore } from "./page-data-store";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe("page data memory", () => {
  it("deduplicates concurrent reads and retains a successful empty result", async () => {
    const store = new PageDataStore();
    const work = deferred<string[]>();
    const load = vi.fn(() => work.promise);
    const key = store.key("positions", "list");
    const a = store.read(key, "positions", load), b = store.read(key, "positions", load);
    await tick();
    expect(load).toHaveBeenCalledTimes(1);
    work.resolve([]);
    expect(await a).toEqual([]);
    expect(await b).toEqual([]);
    expect(store.snapshot(key, "positions")).toMatchObject({ data: [], error: null, stale: false });
  });

  it("returns old data immediately during a deferred refresh, then publishes the new data", async () => {
    let now = 10;
    const store = new PageDataStore(() => undefined, () => now);
    const key = store.key("profile", "profile");
    await store.read(key, "profile", async () => ({ name: "Synthetic A" }));
    const fresh = deferred<{ name: string }>();
    const work = store.revalidate(key, "profile", () => fresh.promise);
    expect(await store.read(key, "profile", () => fresh.promise)).toEqual({ name: "Synthetic A" });
    expect(store.snapshot(key, "profile")).toMatchObject({ at: 10, refreshing: true, stale: true });
    now = 20;
    fresh.resolve({ name: "Synthetic B" });
    await work;
    expect(store.snapshot(key, "profile")).toMatchObject({ data: { name: "Synthetic B" }, at: 20, stale: false });
  });

  it("keeps a failure separate from the last successful data and time", async () => {
    const report = vi.fn(), store = new PageDataStore(report, () => 10);
    const key = store.key("agents", "list");
    await store.read(key, "agents", async () => ["synthetic-agent"]);
    await store.revalidate(key, "agents", async () => { throw { code: "agents_unavailable" }; });
    expect(store.snapshot(key, "agents")).toMatchObject({ data: ["synthetic-agent"], at: 10,
      error: { code: "agents_unavailable" }, stale: true, refreshing: false });
    expect(report).toHaveBeenCalledExactlyOnceWith({ code: "agents_unavailable" });
  });

  it("does not turn a first failure into an empty list", async () => {
    const report = vi.fn(), store = new PageDataStore(report);
    const key = store.key("positions", "list");
    await expect(store.read(key, "positions", async () => { throw { code: "desktop_bad_reply" }; }))
      .rejects.toEqual({ code: "desktop_bad_reply" });
    expect(store.snapshot(key, "positions").data).toBeUndefined();
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("rejects a false successful undefined reply", async () => {
    const store = new PageDataStore(), key = store.key("profile", "profile");
    await expect(store.read(key, "profile", async () => undefined)).rejects.toEqual({ code: "desktop_bad_reply" });
    expect(store.snapshot(key, "profile").error?.code).toBe("desktop_bad_reply");
  });

  it("an invalidation ignores the old response and schedules one current replacement", async () => {
    const store = new PageDataStore(), key = store.key("positions", "list");
    const old = deferred<string[]>(), fresh = deferred<string[]>();
    const load = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const result = store.read(key, "positions", load);
    await tick();
    store.invalidate("positions");
    store.invalidate("positions");
    expect(load).toHaveBeenCalledTimes(1);
    old.resolve(["obsolete"]);
    await tick(); await tick(); await tick();
    expect(store.snapshot(key, "positions").data).toBeUndefined();
    fresh.resolve(["current"]);
    expect(await result).toEqual(["current"]);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("account reset rejects the old completion and cannot put it in the next context", async () => {
    const store = new PageDataStore(), old = deferred<string>();
    const oldKey = store.key("profile", "profile");
    const reading = store.read(oldKey, "profile", () => old.promise);
    await tick();
    store.reset();
    const newKey = store.key("profile", "profile");
    expect(newKey).not.toBe(oldKey);
    await expect(store.read(newKey, "profile", async () => "new-account")).resolves.toBe("new-account");
    old.resolve("old-account");
    await expect(reading).rejects.toEqual({ code: "account_scope_changed" });
    expect(store.snapshot(newKey, "profile").data).toBe("new-account");
  });

  it("queued account transitions block all native loaders until the final one ends", async () => {
    const store = new PageDataStore(), load = vi.fn(async () => "private");
    const endA = store.suspend(), endB = store.suspend();
    await expect(store.read(store.key("profile", "profile"), "profile", load)).rejects.toEqual({ code: "account_scope_changed" });
    endA();
    await expect(store.read(store.key("profile", "profile"), "profile", load)).rejects.toEqual({ code: "account_scope_changed" });
    expect(load).not.toHaveBeenCalled();
    endB(); endB();
    await expect(store.read(store.key("profile", "profile"), "profile", load)).resolves.toBe("private");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("a callback retained from the old account cannot launch a loader under its obsolete key", async () => {
    const store = new PageDataStore(), load = vi.fn(async () => "old");
    const key = store.key("profile", "profile");
    store.reset();
    await expect(store.read(key, "profile", load)).rejects.toEqual({ code: "account_scope_changed" });
    expect(load).not.toHaveBeenCalled();
    expect(store.snapshot(key, "profile").data).toBeUndefined();
  });

  it("an explicit refresh can replace a stuck reader without letting its later answer overwrite the new one", async () => {
    const store = new PageDataStore(), old = deferred<string>();
    const key = store.key("profile", "profile");
    const load = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce("current");
    const off = store.subscribe(key, "profile", () => undefined);
    const first = store.revalidate(key, "profile", load);
    await tick();
    store.invalidate("profile");
    await tick(); await tick(); await tick();
    expect(store.snapshot(key, "profile").data).toBe("current");
    old.resolve("obsolete");
    await first;
    expect(store.snapshot(key, "profile").data).toBe("current");
    expect(load).toHaveBeenCalledTimes(2);
    off();
  });

  it("filter ordering deduplicates but different filters and operations never collide", () => {
    const store = new PageDataStore();
    expect(store.key("positions", "list", { b: 2, a: 1 })).toBe(store.key("positions", "list", { a: 1, b: 2 }));
    expect(store.key("positions", "list", { a: 1 })).not.toBe(store.key("positions", "list", { a: 2 }));
    expect(store.key("positions", "list")).not.toBe(store.key("positions", "facets"));
  });

  it("a topic change refreshes its active readers without reading other topics", async () => {
    const store = new PageDataStore(), profile = vi.fn(async () => "profile"), agents = vi.fn(async () => "agents");
    const a = store.key("profile", "profile"), b = store.key("agents", "list");
    await store.read(a, "profile", profile); await store.read(b, "agents", agents);
    const off = store.subscribe(a, "profile", () => undefined);
    store.invalidate("profile");
    await tick(); await tick();
    expect(profile).toHaveBeenCalledTimes(2);
    expect(agents).toHaveBeenCalledTimes(1);
    off();
  });

  it("topic observers do not wake old filters; only the mounted filter refreshes", async () => {
    const store = new PageDataStore();
    const old = vi.fn(async () => ["old filter"]), current = vi.fn(async () => ["current filter"]);
    const a = store.key("positions", "list", { query: "old" });
    const b = store.key("positions", "list", { query: "current" });
    await store.read(a, "positions", old); await store.read(b, "positions", current);
    const stopTopic = store.subscribeTopic("positions", () => undefined);
    const stopCurrent = store.subscribe(b, "positions", () => undefined);
    store.invalidate("positions");
    await tick(); await tick(); await tick();
    expect(old).toHaveBeenCalledTimes(1);
    expect(current).toHaveBeenCalledTimes(2);
    expect(store.snapshot(a, "positions").stale).toBe(true);
    stopTopic(); stopCurrent();
  });
});
