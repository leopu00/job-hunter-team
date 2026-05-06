/** Test vitest — shared/i18n edge case + shared/backup runner. */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  t, getLocale, setLocale, detectLocale, addTranslations, resetI18n,
  isValidLocale, LOCALES, DEFAULT_LOCALE, DEFAULT_I18N_CONFIG, translations,
} from "../../../shared/i18n/index.js";
import {
  createBackup, restoreBackup, listBackups, applyRetention,
  DEFAULT_BACKUP_CONFIG,
} from "../../../shared/backup/index.js";

// --- i18n edge case ---

describe("i18n — config, consistenza, edge case", () => {
  beforeEach(() => { resetI18n(); });

  it("DEFAULT_I18N_CONFIG: locale it, fallback en, dictionaries vuoti", () => {
    expect(DEFAULT_I18N_CONFIG.locale).toBe("it");
    expect(DEFAULT_I18N_CONFIG.fallbackLocale).toBe("en");
    expect(DEFAULT_I18N_CONFIG.dictionaries.it).toEqual({});
    expect(DEFAULT_I18N_CONFIG.dictionaries.en).toEqual({});
  });
  it("LOCALES contiene it e en, DEFAULT_LOCALE en", () => {
    expect([...LOCALES]).toEqual(["it", "en"]);
    expect(DEFAULT_LOCALE).toBe("en");
  });
  it("isValidLocale: boundary — stringa vuota, numeri, case sensitive", () => {
    expect(isValidLocale("")).toBe(false);
    expect(isValidLocale("IT")).toBe(false);
    expect(isValidLocale("it")).toBe(true);
  });
  it("detectLocale con env JHT_LOCALE", () => {
    const orig = process.env.JHT_LOCALE;
    try {
      process.env.JHT_LOCALE = "en";
      expect(detectLocale()).toBe("en");
      process.env.JHT_LOCALE = "fr";
      expect(detectLocale()).toBe("it"); // fr non valido, fallback
    } finally { if (orig) process.env.JHT_LOCALE = orig; else delete process.env.JHT_LOCALE; }
  });
  it("traduzioni IT/EN hanno stesse chiavi per nav, common, status", () => {
    for (const prefix of ["nav.", "common.", "status."]) {
      const itK = Object.keys(translations.it).filter(k => k.startsWith(prefix)).sort();
      const enK = Object.keys(translations.en).filter(k => k.startsWith(prefix)).sort();
      expect(itK).toEqual(enK);
    }
  });
  it("t() interpolazione time con {n}", () => {
    expect(t("time.minutesAgo", { vars: { n: 15 } })).toBe("15m fa");
    setLocale("en");
    expect(t("time.hoursAgo", { vars: { n: 3 } })).toBe("3h ago");
  });
  it("t() pluralizzazione inietta {count} e {n} automaticamente", () => {
    addTranslations("it", { "file.one": "{count} file", "file.other": "{count} file" });
    expect(t("file", { count: 1 })).toBe("1 file");
    expect(t("file", { count: 7 })).toBe("7 file");
  });
  it("t() chiave mancante in entrambe le locale → ritorna chiave", () => {
    expect(t("non.esiste.chiave")).toBe("non.esiste.chiave");
  });
  it("addTranslations sovrascrive chiave esistente", () => {
    expect(t("common.save")).toBe("Salva");
    addTranslations("it", { "common.save": "Salvare" });
    expect(t("common.save")).toBe("Salvare");
  });
  it("switch locale multiplo mantiene consistenza", () => {
    expect(t("common.delete")).toBe("Elimina");
    setLocale("en");
    expect(t("common.delete")).toBe("Delete");
    setLocale("it");
    expect(t("common.delete")).toBe("Elimina");
  });
});

// --- backup runner ---

describe("backup — create, list, restore, retention", () => {
  let tmpDir: string, backupDir: string, srcDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bk-vitest-"));
    backupDir = path.join(tmpDir, "backups");
    srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir, { recursive: true });
  });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  function mkFile(name: string, content = "{}") {
    fs.writeFileSync(path.join(srcDir, name), content);
    return path.join(srcDir, name);
  }

  it("DEFAULT_BACKUP_CONFIG: retention maxCount=10, maxAgeDays=30, compress=true", () => {
    expect(DEFAULT_BACKUP_CONFIG.retention.maxCount).toBe(10);
    expect(DEFAULT_BACKUP_CONFIG.retention.maxAgeDays).toBe(30);
    expect(DEFAULT_BACKUP_CONFIG.compress).toBe(true);
  });
  it("createBackup nessuna sorgente valida → ok:false", () => {
    const r = createBackup(["/tmp/non-esiste-xyz"], { backupDir });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Nessuna sorgente");
  });
  it("createBackup file valido → ok:true, entry completo", () => {
    const f = mkFile("config.json", '{"version":1}');
    const r = createBackup([f], { backupDir });
    expect(r.ok).toBe(true);
    expect(r.entry).toBeDefined();
    expect(r.entry!.id).toMatch(/^backup-/);
    expect(r.entry!.compressed).toBe(true);
    expect(r.entry!.sizeBytes).toBeGreaterThan(0);
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });
  it("listBackups su dir vuota → array vuoto", () => {
    expect(listBackups({ backupDir })).toEqual([]);
  });
  it("listBackups ordinato desc per createdAt", () => {
    mkFile("a.json"); mkFile("b.json");
    createBackup([path.join(srcDir, "a.json")], { backupDir });
    createBackup([path.join(srcDir, "b.json")], { backupDir });
    const list = listBackups({ backupDir });
    expect(list.length).toBe(2);
    expect(list[0].createdAt).toBeGreaterThanOrEqual(list[1].createdAt);
  });
  it("restoreBackup id inesistente → ok:false", () => {
    const r = restoreBackup("ghost-id", path.join(tmpDir, "res"), { backupDir });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("non trovato");
  });
  it("restoreBackup valido → ok:true, file ripristinati", () => {
    const f = mkFile("data.json", '{"x":42}');
    const bk = createBackup([f], { backupDir });
    const restoreDir = path.join(tmpDir, "restored");
    const r = restoreBackup(bk.entry!.id, restoreDir, { backupDir });
    expect(r.ok).toBe(true);
    expect(r.restoredFiles).toContain("data.json");
    expect(fs.existsSync(path.join(restoreDir, "data.json"))).toBe(true);
  });
  it("applyRetention su catalogo vuoto → 0", () => {
    expect(applyRetention({ maxCount: 5 }, { backupDir })).toBe(0);
  });
  it("applyRetention maxCount rimuove eccesso", () => {
    mkFile("x.json");
    createBackup([path.join(srcDir, "x.json")], { backupDir });
    createBackup([path.join(srcDir, "x.json")], { backupDir });
    createBackup([path.join(srcDir, "x.json")], { backupDir });
    const removed = applyRetention({ maxCount: 1 }, { backupDir });
    expect(removed).toBe(2);
    expect(listBackups({ backupDir }).length).toBe(1);
  });
  it("applyRetention maxAgeDays rimuove vecchi", () => {
    mkFile("y.json");
    createBackup([path.join(srcDir, "y.json")], { backupDir });
    // Manipola createdAt nel catalogo per simulare backup vecchio
    const catPath = path.join(backupDir, "catalog.json");
    const catalog = JSON.parse(fs.readFileSync(catPath, "utf-8"));
    catalog[0].createdAt = Date.now() - 60 * 86400_000; // 60 giorni fa
    fs.writeFileSync(catPath, JSON.stringify(catalog));
    const removed = applyRetention({ maxAgeDays: 30 }, { backupDir });
    expect(removed).toBe(1);
    expect(listBackups({ backupDir }).length).toBe(0);
  });
});
