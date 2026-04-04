/** Test regressione vitest — barrel export shared/, conteggio, shape config, typeof funzioni, re-export types. */
import { describe, it, expect } from "vitest";

const barrels = import.meta.glob("../../../shared/*/index.ts", { eager: true }) as Record<string, Record<string, unknown>>;
const typesAll = import.meta.glob("../../../shared/*/types.ts", { eager: true }) as Record<string, Record<string, unknown>>;

function modName(k: string): string { return k.match(/shared\/([^/]+)\//)?.[1] ?? k; }
function getBarrel(n: string) { return Object.entries(barrels).find(([k]) => modName(k) === n)?.[1]; }
function getTypes(n: string) { return Object.entries(typesAll).find(([k]) => modName(k) === n)?.[1]; }

describe("barrel count regressione — minimo export per modulo", () => {
  const mins: [string, number][] = [
    ["scheduler", 8], ["monitoring", 6], ["i18n", 8], ["backup", 5],
    ["validators", 8], ["context-engine", 4], ["hooks", 4], ["cache", 2],
    ["events", 3], ["notifications", 3],
  ];
  for (const [mod, min] of mins) {
    it(`${mod}: ≥${min} export`, () => {
      const b = getBarrel(mod);
      expect(b, `barrel ${mod} mancante`).toBeDefined();
      expect(Object.keys(b!).length, `${mod} export insufficienti`).toBeGreaterThanOrEqual(min);
    });
  }
});

describe("DEFAULT_*_CONFIG shape — chiavi specifiche non regredite", () => {
  it("BACKUP: backupDir, sources, retention{maxCount,maxAgeDays}, compress", () => {
    const cfg = getBarrel("backup")!.DEFAULT_BACKUP_CONFIG as any;
    expect(cfg).toHaveProperty("backupDir");
    expect(cfg).toHaveProperty("sources");
    expect(cfg.retention).toHaveProperty("maxCount", 10);
    expect(cfg.retention).toHaveProperty("maxAgeDays", 30);
    expect(cfg).toHaveProperty("compress", true);
  });
  it("SCHEDULER: concurrency=3, defaultTimeoutMs=60000", () => {
    const cfg = getTypes("scheduler")!.DEFAULT_SCHEDULER_CONFIG as any;
    expect(cfg).toHaveProperty("concurrency", 3);
    expect(cfg).toHaveProperty("defaultTimeoutMs", 60000);
  });
  it("I18N: locale=it, fallbackLocale=en, dictionaries con it/en", () => {
    const cfg = getTypes("i18n")!.DEFAULT_I18N_CONFIG as any;
    expect(cfg).toHaveProperty("locale", "it");
    expect(cfg).toHaveProperty("fallbackLocale", "en");
    expect(cfg.dictionaries).toHaveProperty("it");
    expect(cfg.dictionaries).toHaveProperty("en");
  });
  it("MONITOR: heartbeatStaleMs, heartbeatDeadMs, metricsHistorySize >0", () => {
    const cfg = getTypes("monitoring")!.DEFAULT_MONITOR_CONFIG as any;
    for (const k of ["heartbeatStaleMs", "heartbeatDeadMs", "metricsHistorySize"]) {
      expect(typeof cfg[k], `monitor.${k}`).toBe("number");
      expect(cfg[k]).toBeGreaterThan(0);
    }
  });
});

describe("function export typeof — firme non regredite", () => {
  it("scheduler: 8 funzioni chiave", () => {
    const b = getBarrel("scheduler")!;
    for (const fn of ["enqueue", "cancel", "getTask", "listTasks", "getStats", "hasCyclicDeps", "resetScheduler", "configureScheduler"]) {
      expect(typeof b[fn], `scheduler.${fn}`).toBe("function");
    }
  });
  it("monitoring: collectMetrics, registerHeartbeat, defineThreshold, checkThresholds", () => {
    const b = getBarrel("monitoring")!;
    for (const fn of ["collectMetrics", "registerHeartbeat", "defineThreshold", "checkThresholds"]) {
      expect(typeof b[fn], `monitoring.${fn}`).toBe("function");
    }
  });
  it("backup: createBackup, restoreBackup, listBackups, applyRetention", () => {
    const b = getBarrel("backup")!;
    for (const fn of ["createBackup", "restoreBackup", "listBackups", "applyRetention"]) {
      expect(typeof b[fn], `backup.${fn}`).toBe("function");
    }
  });
  it("validators: validate, validateOrThrow, nonEmptyString, emailSchema", () => {
    const b = getBarrel("validators")!;
    for (const fn of ["validate", "validateOrThrow"]) {
      expect(typeof b[fn], `validators.${fn}`).toBe("function");
    }
    for (const schema of ["nonEmptyString", "emailSchema"]) {
      expect(b[schema], `validators.${schema}`).toBeDefined();
    }
  });
});

describe("types → barrel re-export — moduli recenti", () => {
  it("scheduler barrel ri-esporta tutti i runtime di types.ts", () => {
    const b = getBarrel("scheduler")!;
    const t = getTypes("scheduler")!;
    for (const key of Object.keys(t)) {
      expect(b[key], `scheduler barrel manca ${key}`).toBeDefined();
    }
  });
  it("monitoring barrel ri-esporta tutti i runtime di types.ts", () => {
    const b = getBarrel("monitoring")!;
    const t = getTypes("monitoring")!;
    for (const key of Object.keys(t)) {
      expect(b[key], `monitoring barrel manca ${key}`).toBeDefined();
    }
  });
});

describe("integrità complessiva — 27 moduli senza circular deps", () => {
  it("tutti i 27 barrel caricati eager, nessuno undefined", () => {
    const names = Object.keys(barrels).map(modName).sort();
    expect(names.length).toBeGreaterThanOrEqual(27);
    for (const [key, mod] of Object.entries(barrels)) {
      expect(mod, `${modName(key)} undefined`).toBeDefined();
      expect(Object.keys(mod).length, `${modName(key)} vuoto`).toBeGreaterThan(0);
    }
  });
});
