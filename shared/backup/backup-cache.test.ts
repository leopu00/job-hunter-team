/** Test integrazione — shared/backup + shared/cache */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createBackup, restoreBackup, listBackups, applyRetention } from "./runner.js";
import { LRUCache } from "../cache/lru-cache.js";
import type { BackupEntry } from "./types.js";

let tmpDir: string, backupDir: string, srcDir: string;
const src = (files: Record<string, string>) => { for (const [n, c] of Object.entries(files)) fs.writeFileSync(path.join(srcDir, n), c); };

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bkcache-"));
  backupDir = path.join(tmpDir, "backups");
  srcDir = path.join(tmpDir, "src");
  fs.mkdirSync(srcDir, { recursive: true });
});
afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

describe("cache backup metadata", () => {
  it("cache lista backup dopo primo fetch", () => {
    const cache = new LRUCache<BackupEntry[]>();
    src({ "a.json": '{"x":1}' });
    createBackup([path.join(srcDir, "a.json")], { backupDir });
    cache.set("backup:list", listBackups({ backupDir }));
    assert.equal(cache.get("backup:list")!.length, 1);
  });

  it("cache singolo backup entry per ID", () => {
    const cache = new LRUCache<BackupEntry>();
    src({ "b.json": '{"y":2}' });
    const r = createBackup([path.join(srcDir, "b.json")], { backupDir });
    cache.set(`backup:${r.entry!.id}`, r.entry!);
    const cached = cache.get(`backup:${r.entry!.id}`);
    assert.equal(cached!.id, r.entry!.id);
    assert.equal(cached!.compressed, true);
  });

  it("cache hit evita re-fetch lista", () => {
    const cache = new LRUCache<BackupEntry[]>();
    src({ "c.json": "{}" });
    createBackup([path.join(srcDir, "c.json")], { backupDir });
    cache.set("backup:list", listBackups({ backupDir }));
    assert.ok(cache.get("backup:list"));
    assert.equal(cache.stats().hits, 1);
  });

  it("cache size metadata per backup", () => {
    const cache = new LRUCache<number>();
    src({ "big.txt": "x".repeat(500) });
    const r = createBackup([path.join(srcDir, "big.txt")], { backupDir });
    cache.set(`backup:size:${r.entry!.id}`, r.entry!.sizeBytes);
    assert.ok(cache.get(`backup:size:${r.entry!.id}`)! > 0);
  });
});

describe("invalidazione post-restore", () => {
  it("invalida cache lista dopo restore", () => {
    const cache = new LRUCache<BackupEntry[]>();
    src({ "d.json": '{"ok":true}' });
    const r = createBackup([path.join(srcDir, "d.json")], { backupDir });
    cache.set("backup:list", listBackups({ backupDir }));
    restoreBackup(r.entry!.id, path.join(tmpDir, "res1"), { backupDir });
    cache.delete("backup:list");
    assert.equal(cache.has("backup:list"), false);
  });

  it("invalida per prefisso backup: dopo restore", () => {
    const cache = new LRUCache<unknown>();
    src({ "e.json": "{}" });
    const r = createBackup([path.join(srcDir, "e.json")], { backupDir });
    cache.set("backup:list", listBackups({ backupDir }));
    cache.set(`backup:${r.entry!.id}`, r.entry);
    cache.set(`backup:size:${r.entry!.id}`, r.entry!.sizeBytes);
    restoreBackup(r.entry!.id, path.join(tmpDir, "res2"), { backupDir });
    assert.equal(cache.invalidateByPrefix("backup:"), 3);
    assert.equal(cache.size, 0);
  });

  it("invalida per pattern regex dopo restore", () => {
    const cache = new LRUCache<unknown>();
    src({ "f.json": "{}" });
    const r = createBackup([path.join(srcDir, "f.json")], { backupDir });
    cache.set(`backup:${r.entry!.id}`, r.entry);
    cache.set("other:key", "keep");
    cache.invalidateByPattern(/^backup:/);
    assert.equal(cache.has(`backup:${r.entry!.id}`), false);
    assert.equal(cache.get("other:key"), "keep");
  });

  it("restore verifica file ripristinati dopo invalidazione cache", () => {
    const cache = new LRUCache<string[]>();
    src({ "g.json": '{"data":"test"}' });
    const r = createBackup([path.join(srcDir, "g.json")], { backupDir });
    const restoreDir = path.join(tmpDir, "res3");
    const result = restoreBackup(r.entry!.id, restoreDir, { backupDir });
    cache.set("restore:files", result.restoredFiles);
    assert.deepEqual(cache.get("restore:files"), ["g.json"]);
    assert.equal(JSON.parse(fs.readFileSync(path.join(restoreDir, "g.json"), "utf-8")).data, "test");
  });
});

describe("backup stats via cache", () => {
  it("cache stats aggregazione backup", () => {
    const cache = new LRUCache<{ count: number; totalSize: number }>();
    src({ "h.json": '{"h":1}', "i.json": '{"i":2}' });
    createBackup([path.join(srcDir, "h.json")], { backupDir });
    createBackup([path.join(srcDir, "i.json")], { backupDir });
    const list = listBackups({ backupDir });
    cache.set("backup:stats", { count: list.length, totalSize: list.reduce((s, e) => s + e.sizeBytes, 0) });
    assert.equal(cache.get("backup:stats")!.count, 2);
    assert.ok(cache.get("backup:stats")!.totalSize > 0);
  });

  it("stats cache invalida dopo retention", () => {
    const cache = new LRUCache<{ count: number }>();
    src({ "j.json": "{}" });
    createBackup([path.join(srcDir, "j.json")], { backupDir });
    createBackup([path.join(srcDir, "j.json")], { backupDir });
    cache.set("backup:stats", { count: 2 });
    applyRetention({ maxCount: 1 }, { backupDir });
    cache.delete("backup:stats");
    assert.equal(cache.has("backup:stats"), false);
    assert.equal(listBackups({ backupDir }).length, 1);
  });

  it("cache hit rate traccia accessi backup metadata", () => {
    const cache = new LRUCache<BackupEntry[]>();
    src({ "k.json": "{}" });
    createBackup([path.join(srcDir, "k.json")], { backupDir });
    cache.set("backup:list", listBackups({ backupDir }));
    cache.get("backup:list"); cache.get("backup:list"); cache.get("backup:missing");
    const s = cache.stats();
    assert.equal(s.hits, 2); assert.equal(s.misses, 1); assert.ok(s.hitRate > 0.6);
  });

  it("TTL scade metadata stale dopo intervallo", () => {
    const cache = new LRUCache<BackupEntry[]>({ defaultTTL: 1 });
    src({ "l.json": "{}" });
    createBackup([path.join(srcDir, "l.json")], { backupDir });
    cache.set("backup:list", listBackups({ backupDir }));
    const start = Date.now(); while (Date.now() - start < 5) { /* wait */ }
    assert.equal(cache.get("backup:list"), undefined);
  });

  it("cache LRU evict vecchi backup metadata quando piena", () => {
    const cache = new LRUCache<string>({ maxEntries: 2 });
    cache.set("backup:a", "first"); cache.set("backup:b", "second"); cache.set("backup:c", "third");
    assert.equal(cache.has("backup:a"), false);
    assert.equal(cache.get("backup:b"), "second");
    assert.equal(cache.get("backup:c"), "third");
  });

  it("clear cache reset completo stats backup", () => {
    const cache = new LRUCache<BackupEntry[]>();
    src({ "m.json": "{}" });
    createBackup([path.join(srcDir, "m.json")], { backupDir });
    cache.set("backup:list", listBackups({ backupDir }));
    cache.set("backup:stats", [] as any);
    cache.clear();
    assert.equal(cache.size, 0);
  });

  it("onEvict callback traccia rimozione metadata backup", () => {
    const evicted: string[] = [];
    const cache = new LRUCache<string>({ maxEntries: 1, onEvict: (k) => evicted.push(k) });
    cache.set("backup:old", "v1"); cache.set("backup:new", "v2");
    assert.equal(evicted.length, 1); assert.equal(evicted[0], "backup:old");
  });
});
