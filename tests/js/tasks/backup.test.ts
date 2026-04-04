/** Test unitari — shared/backup (vitest): create/restore/list, retention, error handling. */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs");
vi.mock("node:child_process", () => ({ execSync: vi.fn(() => "") }));
vi.mock("node:os", () => ({ homedir: () => "/mock-home" }));
vi.mock("node:crypto", () => ({ randomBytes: () => ({ toString: () => "abc123" }) }));

import * as fs from "node:fs";
import { execSync } from "node:child_process";
import { DEFAULT_BACKUP_CONFIG } from "../../../shared/backup/types.js";

const backupDir = "/tmp/test-backups";
const cfg = { backupDir };

function mockCatalog(entries: any[]) {
  vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(entries));
}
function mockNoCatalog() {
  vi.mocked(fs.readFileSync).mockImplementation(() => { throw Object.assign(new Error(), { code: "ENOENT" }); });
}
function mockWrite() {
  vi.mocked(fs.mkdirSync).mockReturnValue(undefined as any);
  vi.mocked(fs.writeFileSync).mockReturnValue(undefined);
  vi.mocked(fs.renameSync).mockReturnValue(undefined);
  vi.mocked(fs.copyFileSync).mockReturnValue(undefined);
  vi.mocked(fs.rmSync).mockReturnValue(undefined);
}

beforeEach(() => { vi.resetAllMocks(); mockWrite(); vi.mocked(execSync).mockReturnValue("" as any); });

describe("DEFAULT_BACKUP_CONFIG", () => {
  it("contiene retention defaults e compress=true", () => {
    expect(DEFAULT_BACKUP_CONFIG.retention.maxCount).toBe(10);
    expect(DEFAULT_BACKUP_CONFIG.retention.maxAgeDays).toBe(30);
    expect(DEFAULT_BACKUP_CONFIG.compress).toBe(true);
    expect(DEFAULT_BACKUP_CONFIG.sources).toEqual([]);
  });
});

describe("listBackups", () => {
  it("ritorna lista vuota se catalogo mancante", async () => {
    mockNoCatalog();
    const { listBackups } = await import("../../../shared/backup/runner.js");
    expect(listBackups(cfg)).toEqual([]);
  });

  it("ritorna entries ordinate per createdAt desc", async () => {
    mockCatalog([
      { id: "old", createdAt: 100, sizeBytes: 0, sources: [], compressed: true, archivePath: "" },
      { id: "new", createdAt: 200, sizeBytes: 0, sources: [], compressed: true, archivePath: "" },
    ]);
    const { listBackups } = await import("../../../shared/backup/runner.js");
    const list = listBackups(cfg);
    expect(list[0].id).toBe("new");
    expect(list[1].id).toBe("old");
  });
});

describe("createBackup", () => {
  it("nessuna sorgente esistente ritorna ok=false", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    mockNoCatalog();
    const { createBackup } = await import("../../../shared/backup/runner.js");
    const r = createBackup(["/fake/path"], cfg);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Nessuna sorgente");
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("crea backup compresso con tar czf e aggiorna catalogo", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => false, size: 42 } as any);
    mockCatalog([]);
    const { createBackup } = await import("../../../shared/backup/runner.js");
    const r = createBackup(["/data/config.json"], { ...cfg, compress: true });
    expect(r.ok).toBe(true);
    expect(r.entry).toBeDefined();
    expect(r.entry!.compressed).toBe(true);
    expect(r.entry!.archivePath).toContain(".tar.gz");
    const tarCalls = vi.mocked(execSync).mock.calls.map(c => String(c[0]));
    expect(tarCalls.some(c => c.includes("czf"))).toBe(true);
  });

  it("crea backup non compresso con tar cf", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => false, size: 10 } as any);
    mockCatalog([]);
    const { createBackup } = await import("../../../shared/backup/runner.js");
    const r = createBackup(["/data/f.txt"], { ...cfg, compress: false });
    expect(r.ok).toBe(true);
    expect(r.entry!.compressed).toBe(false);
    expect(r.entry!.archivePath).toMatch(/\.tar$/);
  });

  it("errore durante tar ritorna ok=false con messaggio", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => false, size: 1 } as any);
    vi.mocked(execSync).mockImplementation((cmd) => {
      if (String(cmd).includes("tar")) throw new Error("tar failed");
      return "" as any;
    });
    mockCatalog([]);
    const { createBackup } = await import("../../../shared/backup/runner.js");
    const r = createBackup(["/data/x"], cfg);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("tar failed");
  });

  it("backup include durationMs positivo", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({ isDirectory: () => false, size: 5 } as any);
    mockCatalog([]);
    const { createBackup } = await import("../../../shared/backup/runner.js");
    const r = createBackup(["/data/a"], cfg);
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("restoreBackup", () => {
  it("backup non trovato in catalogo ritorna ok=false", async () => {
    mockCatalog([]);
    const { restoreBackup } = await import("../../../shared/backup/runner.js");
    const r = restoreBackup("non-esiste", "/tmp/restore", cfg);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("non trovato");
  });

  it("archivio mancante su disco ritorna ok=false", async () => {
    mockCatalog([{ id: "b1", createdAt: 1, sizeBytes: 0, sources: [], compressed: true, archivePath: "/gone.tar.gz" }]);
    vi.mocked(fs.existsSync).mockImplementation((p) => String(p) !== "/gone.tar.gz");
    const { restoreBackup } = await import("../../../shared/backup/runner.js");
    const r = restoreBackup("b1", "/tmp/restore", cfg);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("mancante");
  });

  it("restore compresso usa tar xzf e ritorna restoredFiles", async () => {
    const catalog = [{ id: "b1", createdAt: 1, sizeBytes: 0, sources: [], compressed: true, archivePath: "/bk.tar.gz" }];
    const manifest = { version: "1.0.0", createdAt: 1, sources: [], files: [{ relativePath: "config.json", sizeBytes: 42 }] };
    vi.mocked(fs.readFileSync).mockImplementation(((p: string) => {
      if (p.includes("catalog")) return JSON.stringify(catalog);
      if (p.includes("manifest")) return JSON.stringify(manifest);
      return "";
    }) as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.unlinkSync).mockReturnValue(undefined);
    const { restoreBackup } = await import("../../../shared/backup/runner.js");
    const r = restoreBackup("b1", "/tmp/out", cfg);
    expect(r.ok).toBe(true);
    expect(r.restoredFiles).toContain("config.json");
    const tarCalls = vi.mocked(execSync).mock.calls.map(c => String(c[0]));
    expect(tarCalls.some(c => c.includes("xzf"))).toBe(true);
  });

  it("restore include durationMs", async () => {
    mockCatalog([]);
    const { restoreBackup } = await import("../../../shared/backup/runner.js");
    const r = restoreBackup("x", "/tmp", cfg);
    expect(typeof r.durationMs).toBe("number");
  });
});

describe("applyRetention", () => {
  it("catalogo vuoto ritorna 0 rimossi", async () => {
    mockNoCatalog();
    const { applyRetention } = await import("../../../shared/backup/runner.js");
    expect(applyRetention({ maxCount: 5 }, cfg)).toBe(0);
  });

  it("maxCount rimuove backup in eccesso (i più vecchi)", async () => {
    mockCatalog([
      { id: "b1", createdAt: 100, archivePath: "/a1.tar.gz" },
      { id: "b2", createdAt: 200, archivePath: "/a2.tar.gz" },
      { id: "b3", createdAt: 300, archivePath: "/a3.tar.gz" },
    ]);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.unlinkSync).mockReturnValue(undefined);
    const { applyRetention } = await import("../../../shared/backup/runner.js");
    const removed = applyRetention({ maxCount: 1 }, cfg);
    expect(removed).toBe(2);
    expect(fs.unlinkSync).toHaveBeenCalledTimes(2);
  });

  it("maxAgeDays rimuove backup oltre la soglia", async () => {
    const old = Date.now() - 60 * 86400_000;
    const recent = Date.now() - 1 * 86400_000;
    mockCatalog([
      { id: "old", createdAt: old, archivePath: "/old.tar.gz" },
      { id: "new", createdAt: recent, archivePath: "/new.tar.gz" },
    ]);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.unlinkSync).mockReturnValue(undefined);
    const { applyRetention } = await import("../../../shared/backup/runner.js");
    const removed = applyRetention({ maxAgeDays: 30 }, cfg);
    expect(removed).toBe(1);
  });
});
