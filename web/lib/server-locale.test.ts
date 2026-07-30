/**
 * Test unitari — web/lib/server-locale (lingua dell'area protetta)
 * Esegui: cd tests/js && npx vitest run
 *
 * Il difetto che questi test sorvegliano: l'area riservata leggeva la lingua
 * SOLO da ~/.jht/i18n-prefs.json. Sul sito cloud quel file non esiste, il
 * `catch` scattava a ogni richiesta e la pagina tornava in italiano anche con
 * l'interfaccia in inglese ("DISTRIBUZIONE SCORE" sulla /map). È la stessa
 * famiglia di difetti dei nomi-ruolo nel gioco: la traduzione che ripiega in
 * silenzio sull'italiano. Un `catch` che restituisce una lingua non fallisce
 * mai in modo rumoroso, quindi serve un test — la correzione da sola non basta.
 *
 * Ogni caso monta il proprio JHT_HOME in una cartella temporanea: senza,
 * il ~/.jht di chi sviluppa deciderebbe l'esito.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDashboardT } from "./dashboard-i18n.ts";
import type { ServerLocale } from "./server-locale.ts";

// `vi.mock` è issato sopra gli import: la cassetta condivisa col factory deve
// nascere con `vi.hoisted`, altrimenti il factory la legge prima che esista.
const req = vi.hoisted(() => ({ cookie: null as string | null }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "NEXT_LOCALE" && req.cookie !== null
        ? { name, value: req.cookie }
        : undefined,
  }),
}));

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "jht-locale-"));
  req.cookie = null;
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  delete process.env.JHT_HOME;
});

/** Scrive il file di preferenze del desktop. Nessuna chiamata = cloud. */
function writePrefs(content: string) {
  fs.writeFileSync(path.join(home, "i18n-prefs.json"), content, "utf-8");
}

/**
 * Ricarica il modulo: JHT_HOME viene letta a import-time da lib/jht-paths,
 * quindi il path del file di preferenze si fissa al primo import.
 */
async function resolveLocale(): Promise<ServerLocale> {
  process.env.JHT_HOME = home;
  vi.resetModules();
  const { getServerLocale } = await import("./server-locale.ts");
  return getServerLocale();
}

describe("cloud — il file ~/.jht/i18n-prefs.json non esiste", () => {
  it("il titolo server-side esce nella lingua del cookie, non in italiano", async () => {
    // Il caso osservato dal vero: interfaccia in inglese, titolo della /map.
    req.cookie = "en";
    const locale = await resolveLocale();
    expect(locale).toBe("en");
    expect(getDashboardT(locale).score_distribution).toBe("Score Distribution");
    expect(getDashboardT(locale).score_distribution).not.toBe(
      "Distribuzione Score",
    );
  });

  it("vale per tutte e sette le lingue: nessuna ricade sull'italiano", async () => {
    const expected: Record<ServerLocale, string> = {
      it: "Distribuzione Score",
      en: "Score Distribution",
      hu: "Pontszám eloszlás",
      es: "Distribución de Score",
      de: "Score-Verteilung",
      fr: "Distribution des scores",
      pt: "Distribuição de Score",
    };
    for (const [code, title] of Object.entries(expected)) {
      req.cookie = code;
      const locale = await resolveLocale();
      expect(locale, `cookie ${code}`).toBe(code);
      expect(getDashboardT(locale).score_distribution, `cookie ${code}`).toBe(
        title,
      );
    }
  });

  it("senza cookie e senza file resta l'italiano (unico caso di default)", async () => {
    expect(await resolveLocale()).toBe("it");
  });

  it("un cookie con una lingua che non gestiamo non conta come scelta", async () => {
    req.cookie = "xx";
    expect(await resolveLocale()).toBe("it");
  });
});

describe("desktop — il file esiste e resta la preferenza persistente", () => {
  it("senza cookie comanda il file, non il default", async () => {
    writePrefs(JSON.stringify({ locale: "hu" }));
    const locale = await resolveLocale();
    expect(locale).toBe("hu");
    expect(getDashboardT(locale).score_distribution).toBe("Pontszám eloszlás");
  });

  it("cookie invalido → si ricade sul file, non sull'italiano", async () => {
    writePrefs(JSON.stringify({ locale: "de" }));
    req.cookie = "klingon";
    expect(await resolveLocale()).toBe("de");
  });

  it("file rotto o senza locale → italiano, senza eccezioni", async () => {
    writePrefs("{non-json");
    expect(await resolveLocale()).toBe("it");
    writePrefs(JSON.stringify({ locale: "xx" }));
    expect(await resolveLocale()).toBe("it");
    writePrefs(JSON.stringify({}));
    expect(await resolveLocale()).toBe("it");
  });
});

describe("le due fonti divergono — vince il cookie", () => {
  it("cookie appena cambiato, file ancora sulla lingua vecchia", async () => {
    // POST /api/i18n scrive file e cookie insieme: il file non può essere più
    // fresco del cookie, il contrario sì (sul cloud la scrittura fallisce).
    writePrefs(JSON.stringify({ locale: "it" }));
    req.cookie = "fr";
    expect(await resolveLocale()).toBe("fr");
  });

  it("anche quando è il cookie a dire italiano", async () => {
    writePrefs(JSON.stringify({ locale: "en" }));
    req.cookie = "it";
    expect(await resolveLocale()).toBe("it");
  });
});

describe("readLocalePrefsFile — distingue «assente» da «italiano»", () => {
  it("null quando non c'è nulla da leggere", async () => {
    process.env.JHT_HOME = home;
    vi.resetModules();
    const { readLocalePrefsFile } = await import("./server-locale.ts");
    // Se qui tornasse "it" chi chiama non potrebbe più sapere se l'utente ha
    // scelto l'italiano o se semplicemente non c'è un file: è esattamente
    // l'ambiguità da cui nasceva il difetto.
    expect(readLocalePrefsFile()).toBeNull();
    writePrefs(JSON.stringify({ locale: "it" }));
    expect(readLocalePrefsFile()).toBe("it");
  });
});
