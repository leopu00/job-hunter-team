/** Test integrazione — shared/migrations + shared/i18n (vitest): migrazioni con traduzioni, fallback, rollback. */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  loadState, saveState, compareVersions,
  migrateUp, migrateDown, getPendingMigrations, getCurrentVersion,
} from "../../../shared/migrations/runner.js";
import { DEFAULT_MIGRATION_CONFIG } from "../../../shared/migrations/types.js";
import type { Migration } from "../../../shared/migrations/types.js";
import {
  t, setLocale, getLocale, addTranslations, resetI18n, detectLocale,
} from "../../../shared/i18n/i18n.js";
import { isValidLocale, DEFAULT_I18N_CONFIG } from "../../../shared/i18n/types.js";

let tmpDir: string;
let statePath: string;

function mkMig(version: string, desc: string, upFn?: (c: Record<string, unknown>) => void, downFn?: (c: Record<string, unknown>) => void): Migration {
  return {
    version, description: desc,
    up: (c) => { upFn?.(c); return c; },
    down: (c) => { downFn?.(c); return c; },
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mig-i18n-"));
  statePath = path.join(tmpDir, "state.json");
  resetI18n();
});
afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

// --- Integrazione: migrazioni che aggiungono chiavi i18n ---

describe("migrazione + i18n — aggiunta chiavi traduzioni", () => {
  it("migrazione aggiunge chiavi i18n usabili da t()", () => {
    const migs = [mkMig("1.0.0", "add i18n keys", () => {
      addTranslations("it", { "feature.newButton": "Nuovo pulsante" });
      addTranslations("en", { "feature.newButton": "New button" });
    })];
    const r = migrateUp(migs, {}, { statePath });
    expect(r.ok).toBe(true);
    expect(t("feature.newButton")).toBe("Nuovo pulsante");
    setLocale("en");
    expect(t("feature.newButton")).toBe("New button");
  });

  it("rollback rimuove chiavi i18n aggiunte dalla migrazione", () => {
    const migs = [mkMig("1.0.0", "add keys",
      () => { addTranslations("it", { "temp.key": "valore" }); },
      () => { resetI18n(); },
    )];
    migrateUp(migs, {}, { statePath });
    expect(t("temp.key")).toBe("valore");
    migrateDown(migs, {}, "0.0.0", { statePath });
    expect(t("temp.key")).toBe("temp.key"); // fallback alla chiave
  });

  it("migrazioni sequenziali aggiungono chiavi a namespace diversi", () => {
    const migs = [
      mkMig("1.0.0", "nav keys", () => { addTranslations("it", { "nav.export": "Esporta" }); }),
      mkMig("2.0.0", "status keys", () => { addTranslations("it", { "status.pending": "in attesa" }); }),
    ];
    migrateUp(migs, {}, { statePath });
    expect(t("nav.export")).toBe("Esporta");
    expect(t("status.pending")).toBe("in attesa");
    expect(getCurrentVersion(statePath)).toBe("2.0.0");
  });

  it("migrazione fallita non applica chiavi i18n della versione fallita", () => {
    const migs = [
      mkMig("1.0.0", "ok", () => { addTranslations("it", { "v1.key": "ok" }); }),
      mkMig("2.0.0", "fail", () => { throw new Error("boom"); }),
    ];
    const r = migrateUp(migs, {}, { statePath });
    expect(r.ok).toBe(false);
    expect(r.rolledBack).toBe(true);
  });
});

describe("migrazione + i18n — fallback locale", () => {
  it("migrazione aggiunge solo en, fallback funziona da it", () => {
    const migs = [mkMig("1.0.0", "en only", () => {
      addTranslations("en", { "onlyEn.msg": "English only message" });
    })];
    migrateUp(migs, {}, { statePath });
    expect(getLocale()).toBe("it");
    expect(t("onlyEn.msg")).toBe("English only message"); // fallback a en
  });

  it("migrazione cambia locale nella config e t() risponde", () => {
    const migs = [mkMig("1.0.0", "switch locale", (c) => {
      c.locale = "en";
      setLocale("en");
    }, (c) => {
      c.locale = "it";
      setLocale("it");
    })];
    const cfg: Record<string, unknown> = { locale: "it" };
    migrateUp(migs, cfg, { statePath });
    expect(cfg.locale).toBe("en");
    expect(t("common.save")).toBe("Save");
    migrateDown(migs, cfg, "0.0.0", { statePath });
    expect(cfg.locale).toBe("it");
    expect(t("common.save")).toBe("Salva");
  });
});

// --- Edge cases migrations ---

describe("migrations — edge cases", () => {
  it("migrateUp con lista vuota ritorna ok senza applicare nulla", () => {
    const r = migrateUp([], {}, { statePath });
    expect(r.ok).toBe(true);
    expect(r.applied).toHaveLength(0);
  });

  it("migrateDown a 0.0.0 reverte tutte le migrazioni", () => {
    const log: string[] = [];
    const migs = [
      mkMig("1.0.0", "v1", () => log.push("up1"), () => log.push("down1")),
      mkMig("2.0.0", "v2", () => log.push("up2"), () => log.push("down2")),
    ];
    migrateUp(migs, {}, { statePath });
    migrateDown(migs, {}, "0.0.0", { statePath });
    expect(log).toContain("down1");
    expect(log).toContain("down2");
  });

  it("compareVersions gestisce versioni a 4 segmenti", () => {
    expect(compareVersions("1.0.0.1", "1.0.0.0")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0.0")).toBe(0);
  });

  it("getPendingMigrations ordina per versione crescente", () => {
    const migs = [mkMig("3.0.0", "c"), mkMig("1.0.0", "a"), mkMig("2.0.0", "b")];
    const pending = getPendingMigrations(migs, statePath);
    expect(pending.map(m => m.version)).toEqual(["1.0.0", "2.0.0", "3.0.0"]);
  });

  it("DEFAULT_MIGRATION_CONFIG ha initialVersion 0.0.0 e backup true", () => {
    expect(DEFAULT_MIGRATION_CONFIG.initialVersion).toBe("0.0.0");
    expect(DEFAULT_MIGRATION_CONFIG.backup).toBe(true);
  });
});

// --- Edge cases i18n ---

describe("i18n — edge cases", () => {
  it("t() con interpolazione e count insieme", () => {
    addTranslations("it", { "msg.one": "{name} ha 1 messaggio", "msg.other": "{name} ha {count} messaggi" });
    expect(t("msg", { count: 1, vars: { name: "Leo" } })).toBe("Leo ha 1 messaggio");
    expect(t("msg", { count: 5, vars: { name: "Leo" } })).toBe("Leo ha 5 messaggi");
  });

  it("detectLocale con Accept-Language multiplo preferisce primo valido", () => {
    expect(detectLocale("fr-FR,de,en-US,it")).toBe("en");
  });

  it("isValidLocale rifiuta stringhe simili ma non valide", () => {
    expect(isValidLocale("IT")).toBe(false);
    expect(isValidLocale("italian")).toBe(false);
  });

  it("DEFAULT_I18N_CONFIG ha locale it e fallback en", () => {
    expect(DEFAULT_I18N_CONFIG.locale).toBe("it");
    expect(DEFAULT_I18N_CONFIG.fallbackLocale).toBe("en");
  });

  it("addTranslations sovrascrive chiave esistente", () => {
    addTranslations("it", { "common.save": "Salva modifiche" });
    expect(t("common.save")).toBe("Salva modifiche");
  });
});
