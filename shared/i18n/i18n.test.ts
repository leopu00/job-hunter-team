/**
 * Test unitari — shared/i18n
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  t, getLocale, setLocale, getFallbackLocale, detectLocale,
  addTranslations, resetI18n,
} from "./i18n.js";
import { isValidLocale, LOCALES, DEFAULT_LOCALE } from "./types.js";
import { translations } from "./translations.js";

beforeEach(() => resetI18n());

// --- isValidLocale ---

describe("isValidLocale", () => {
  it("accetta 'it' e 'en'", () => {
    assert.ok(isValidLocale("it"));
    assert.ok(isValidLocale("en"));
  });

  it("rifiuta locale non supportati", () => {
    assert.equal(isValidLocale("fr"), false);
    assert.equal(isValidLocale("de"), false);
    assert.equal(isValidLocale(""), false);
  });
});

// --- LOCALES / DEFAULT_LOCALE ---

describe("constants", () => {
  it("LOCALES contiene it e en", () => {
    assert.deepEqual([...LOCALES], ["it", "en"]);
  });

  it("DEFAULT_LOCALE e' en", () => {
    assert.equal(DEFAULT_LOCALE, "en");
  });
});

// --- getLocale / setLocale ---

describe("getLocale / setLocale", () => {
  it("default e' it", () => {
    assert.equal(getLocale(), "it");
  });

  it("setLocale cambia locale attivo", () => {
    setLocale("en");
    assert.equal(getLocale(), "en");
  });

  it("getFallbackLocale ritorna en", () => {
    assert.equal(getFallbackLocale(), "en");
  });
});

// --- detectLocale ---

describe("detectLocale", () => {
  it("rileva it da Accept-Language", () => {
    assert.equal(detectLocale("it-IT,en;q=0.8"), "it");
  });

  it("rileva en da Accept-Language", () => {
    assert.equal(detectLocale("en-US,it;q=0.5"), "en");
  });

  it("ritorna default se nessun match", () => {
    assert.equal(detectLocale("fr-FR,de;q=0.5"), "it");
  });

  it("ritorna default senza header", () => {
    assert.equal(detectLocale(), "it");
  });
});

// --- t() base ---

describe("t() traduzioni base", () => {
  it("traduce chiave italiana", () => {
    assert.equal(t("common.save"), "Salva");
    assert.equal(t("nav.agents"), "Agenti");
  });

  it("traduce chiave inglese dopo setLocale", () => {
    setLocale("en");
    assert.equal(t("common.save"), "Save");
    assert.equal(t("nav.agents"), "Agents");
  });

  it("ritorna chiave se non trovata", () => {
    assert.equal(t("nonexistent.key"), "nonexistent.key");
  });

  it("usa fallback esplicito se chiave mancante", () => {
    assert.equal(t("missing.key", { fallback: "valore default" }), "valore default");
  });
});

// --- t() interpolazione ---

describe("t() interpolazione", () => {
  it("sostituisce {n} con variabile", () => {
    assert.equal(t("time.minutesAgo", { vars: { n: 5 } }), "5m fa");
  });

  it("sostituisce multiple variabili", () => {
    addTranslations("it", { "test.hello": "Ciao {name}, hai {count} messaggi" });
    assert.equal(t("test.hello", { vars: { name: "Leo", count: 3 } }), "Ciao Leo, hai 3 messaggi");
  });

  it("lascia placeholder se variabile mancante", () => {
    addTranslations("it", { "test.partial": "Ciao {name}" });
    assert.equal(t("test.partial"), "Ciao {name}");
  });
});

// --- t() fallback locale ---

describe("t() fallback locale", () => {
  it("fallback a en se chiave mancante in it", () => {
    addTranslations("en", { "only.english": "English only" });
    assert.equal(t("only.english"), "English only");
  });

  it("preferisce locale attivo su fallback", () => {
    addTranslations("it", { "both.key": "Italiano" });
    addTranslations("en", { "both.key": "English" });
    assert.equal(t("both.key"), "Italiano");
    setLocale("en");
    assert.equal(t("both.key"), "English");
  });
});

// --- t() pluralizzazione ---

describe("t() pluralizzazione", () => {
  it("usa .one per count=1", () => {
    addTranslations("it", { "items.one": "1 elemento", "items.other": "{count} elementi" });
    assert.equal(t("items", { count: 1 }), "1 elemento");
  });

  it("usa .other per count!=1", () => {
    addTranslations("it", { "items.one": "1 elemento", "items.other": "{count} elementi" });
    assert.equal(t("items", { count: 5 }), "5 elementi");
  });

  it("usa .other per count=0", () => {
    addTranslations("it", { "items.one": "1 elemento", "items.other": "{count} elementi" });
    assert.equal(t("items", { count: 0 }), "0 elementi");
  });

  it("fallback a chiave base se plurale non definito", () => {
    addTranslations("it", { "simple": "semplice" });
    assert.equal(t("simple", { count: 3 }), "semplice");
  });
});

// --- addTranslations ---

describe("addTranslations", () => {
  it("aggiunge nuove chiavi senza sovrascrivere esistenti", () => {
    const before = t("common.save");
    addTranslations("it", { "custom.new": "nuova" });
    assert.equal(t("common.save"), before);
    assert.equal(t("custom.new"), "nuova");
  });
});

// --- resetI18n ---

describe("resetI18n", () => {
  it("ripristina locale e dizionari", () => {
    setLocale("en");
    addTranslations("it", { "temp": "temporaneo" });
    resetI18n();
    assert.equal(getLocale(), "it");
    assert.equal(t("temp"), "temp");
  });
});

// --- translations dizionari ---

describe("translations builtin", () => {
  it("it e en hanno le stesse chiavi nav", () => {
    const itKeys = Object.keys(translations.it).filter(k => k.startsWith("nav.")).sort();
    const enKeys = Object.keys(translations.en).filter(k => k.startsWith("nav.")).sort();
    assert.deepEqual(itKeys, enKeys);
  });
});
