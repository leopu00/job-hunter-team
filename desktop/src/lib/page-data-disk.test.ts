import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { PageDataDisk } from "./page-data-disk";
import { PageDataStore } from "./page-data-store";
import { pageDataIdentityReader, type VerifiedPageDataIdentity } from "./page-data-persistence";
import type { StoredPageCopy } from "./page-data-indexeddb";

const scopeA = { accountFingerprint: "synthetic-account-a", teamFingerprint: "synthetic-team-a" };
const scopeB = { accountFingerprint: "synthetic-account-b", teamFingerprint: "synthetic-team-a" };
const row = [{ id: "synthetic-position", title: "Synthetic role" }];
let now: number, epoch: number, scope: VerifiedPageDataIdentity | null;
let rows: Map<string, StoredPageCopy>;
let storage: { get: Mock<(key: string) => Promise<unknown>>; put: Mock<(copy: StoredPageCopy) => Promise<void>> };
const key = () => JSON.stringify([epoch, "positions", "list", { limit: 25 }]);
const disk = () => new PageDataDisk(async () => scope, () => epoch, storage, () => now);
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

beforeEach(() => {
  now = 1000; epoch = 0; scope = scopeA; rows = new Map();
  storage = { get: vi.fn<(key: string) => Promise<unknown>>(async (key) => rows.get(key) ?? null),
    put: vi.fn<(copy: StoredPageCopy) => Promise<void>>(async (copy) => { rows.set(copy.key, copy); }) };
});

describe("verified page copies", () => {
  it.each(["absent producer", "no attested team"])("never accesses disk with %s", async (mode) => {
    scope = null;
    expect(pageDataIdentityReader).toBeNull();
    const saved = mode === "absent producer" ? new PageDataDisk(pageDataIdentityReader, () => epoch, storage) : disk();
    expect(await saved.read(key())).toBeNull();
    await saved.write(key(), { at: now, data: row });
    expect(storage.get).not.toHaveBeenCalled(); expect(storage.put).not.toHaveBeenCalled();
  });

  it("survives a new archive and isolates account, team, filters, and operation", async () => {
    await disk().write(key(), { at: now, data: row });
    epoch++;
    expect(await disk().read(key())).toEqual({ at: 1000, data: row });
    scope = scopeB;
    expect(await disk().read(key())).toBeNull();
    scope = { ...scopeA, teamFingerprint: "synthetic-team-b" };
    expect(await disk().read(key())).toBeNull();
    scope = scopeA;
    expect(await disk().read(JSON.stringify([epoch, "positions", "facets", { limit: 25 }]))).toBeNull();
    expect(await disk().read(JSON.stringify([epoch, "positions", "list", { limit: 50 }]))).toBeNull();
  });

  it("an identity answer from a discarded scope never reaches disk", async () => {
    let resolve!: (scope: VerifiedPageDataIdentity) => void;
    const saved = new PageDataDisk(() => new Promise((done) => { resolve = done; }), () => epoch, storage);
    const reading = saved.read(key()); epoch++; resolve(scopeA);
    expect(await reading).toBeNull(); expect(storage.get).not.toHaveBeenCalled();
  });

  it("does not persist the agent action target or an unverified identity", async () => {
    await disk().write(JSON.stringify([epoch, "agents", "list", {}]), { at: now, data: { target: "synthetic-capability" } });
    expect(storage.put).not.toHaveBeenCalled();
    scope = { accountFingerprint: "", teamFingerprint: "synthetic-team" };
    await expect(disk().write(key(), { at: now, data: row })).rejects.toEqual({ code: "page_data_disk_invalid" });
    expect(storage.put).not.toHaveBeenCalled();
  });

  it.each(["json", "version", "scope", "shape", "future", "oversized"])("rejects %s corruption instead of an empty list", async (kind) => {
    await disk().write(key(), { at: now, data: row });
    const saved = [...rows.values()][0], value = JSON.parse(saved.text);
    if (kind === "version") value.version = 2;
    if (kind === "scope") value.key = "another-synthetic-scope";
    if (kind === "shape") value.data = {};
    if (kind === "future") value.at = now + 1;
    saved.text = kind === "json" ? "{" : kind === "oversized" ? "x".repeat(4 * 1024 * 1024 + 1) : JSON.stringify(value);
    await expect(disk().read(key())).rejects.toEqual({ code: "page_data_disk_invalid" });
  });

  it("expired copies are cache misses, while failed I/O keeps a distinct error", async () => {
    await disk().write(key(), { at: now, data: row });
    now += 8 * 24 * 60 * 60 * 1000;
    expect(await disk().read(key())).toBeNull();
    storage.get.mockRejectedValue(new Error("synthetic private detail"));
    await expect(disk().read(key())).rejects.toEqual({ code: "page_data_disk_read_failed" });
    storage.put.mockRejectedValue(new Error("synthetic private detail"));
    await expect(disk().write(key(), { at: now, data: row })).rejects.toEqual({ code: "page_data_disk_write_failed" });
  });

  it("queued writes cannot put an older generation after the newer one", async () => {
    let release!: () => void;
    storage.put.mockImplementationOnce((copy: StoredPageCopy) => new Promise<void>((resolve) => {
      release = () => { rows.set(copy.key, copy); resolve(); };
    }));
    const saved = disk(), oldKey = key();
    const old = saved.write(oldKey, { at: now, data: row });
    await tick(); epoch++;
    const fresh = saved.write(key(), { at: now, data: [{ id: "current", title: "Synthetic current" }] });
    release(); await old; await fresh;
    expect((await saved.read(key()))?.data).toEqual([{ id: "current", title: "Synthetic current" }]);
  });

  it("a discarded queued generation is not written", async () => {
    await disk().write(key(), { at: now, data: row }, () => false);
    expect(storage.put).not.toHaveBeenCalled();
  });
});

describe("memory with disk hydration", () => {
  it("returns saved data while live data is pending, then shows the refresh failure separately", async () => {
    const persistence = disk(); await persistence.write(key(), { at: 900, data: row });
    const report = vi.fn(), store = new PageDataStore(report, () => now, persistence);
    let reject!: (reason: unknown) => void;
    const live = new Promise<unknown>((_, fail) => { reject = fail; });
    expect(await store.read(key(), "positions", () => live)).toEqual(row);
    expect(store.snapshot(key(), "positions")).toMatchObject({ fromDisk: true, at: 900, refreshing: true });
    reject({ code: "positions_unavailable" }); await tick();
    expect(store.snapshot(key(), "positions")).toMatchObject({ data: row, error: { code: "positions_unavailable" }, at: 900 });
    expect(report).toHaveBeenCalledWith({ code: "positions_unavailable" });
  });

  it("late disk data cannot overwrite the native success", async () => {
    let resolve!: (copy: { data: unknown; at: number }) => void;
    const persistence = { read: () => new Promise<{ data: unknown; at: number }>((done) => { resolve = done; }), write: vi.fn(async () => true) };
    const store = new PageDataStore(() => undefined, () => now, persistence);
    expect(await store.read(key(), "positions", async () => row)).toEqual(row);
    resolve({ data: ["obsolete"], at: 100 }); await tick();
    expect(store.snapshot(key(), "positions")).toMatchObject({ data: row, at: 1000, fromDisk: false });
  });

  it("failed writes remain visible beside the live data and are logged", async () => {
    const report = vi.fn(), persistence = disk();
    storage.put.mockRejectedValue(new Error("synthetic disk full"));
    const store = new PageDataStore(report, () => now, persistence);
    await store.read(key(), "positions", async () => row); await tick();
    expect(store.snapshot(key(), "positions")).toMatchObject({ data: row, diskError: { code: "page_data_disk_write_failed" } });
    expect(report).toHaveBeenCalledWith({ code: "page_data_disk_write_failed" });
  });

  it("late disk data from the former account cannot enter a new context", async () => {
    let resolve!: (copy: { data: unknown; at: number }) => void;
    const persistence = { read: () => new Promise<{ data: unknown; at: number }>((done) => { resolve = done; }), write: vi.fn(async () => false) };
    const store = new PageDataStore(() => undefined, () => now, persistence), oldKey = key();
    void store.revalidate(oldKey, "positions", () => new Promise(() => undefined));
    store.reset();
    resolve({ data: row, at: 900 }); await tick();
    expect(store.snapshot(store.key("positions", "list"), "positions").data).toBeUndefined();
    expect(persistence.write).not.toHaveBeenCalled();
  });

  it("a failed read is not hidden by a write that did not run", async () => {
    const report = vi.fn();
    const persistence = { read: async () => { throw { code: "page_data_disk_read_failed" }; }, write: vi.fn(async () => false) };
    const store = new PageDataStore(report, () => now, persistence);
    await store.read(key(), "positions", async () => row); await tick();
    expect(store.snapshot(key(), "positions")).toMatchObject({ data: row,
      diskError: { code: "page_data_disk_read_failed" }, diskErrorAt: 1000 });
    expect(report).toHaveBeenCalledWith({ code: "page_data_disk_read_failed" });
  });

  it("Refresh retries a failed disk read once and recovers its copy while native is still unavailable", async () => {
    const persistence = { read: vi.fn().mockRejectedValueOnce({ code: "page_data_disk_read_failed" })
      .mockResolvedValueOnce({ data: row, at: 900 }), write: vi.fn(async () => false) };
    const store = new PageDataStore(() => undefined, () => now, persistence);
    const load = vi.fn(async () => { throw { code: "positions_unavailable" }; });
    await expect(store.read(key(), "positions", load)).rejects.toEqual({ code: "positions_unavailable" });
    await tick();
    expect(persistence.read).toHaveBeenCalledTimes(1);
    store.invalidate("positions");
    await expect(store.read(key(), "positions", load)).resolves.toEqual(row);
    await tick();
    expect(persistence.read).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenCalledTimes(2);
    expect(store.snapshot(key(), "positions")).toMatchObject({ data: row, at: 900,
      error: { code: "positions_unavailable" }, fromDisk: true });
  });
});
