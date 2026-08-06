/**
 * Rete di sicurezza della guida di setup.
 *
 * La guida è fatta di dati: capitoli, fasi e un registro di schermate. I
 * modi in cui si rompe sono tutti silenziosi — una fase che punta a una
 * schermata inesistente non mostra niente, una traduzione mancante mostra
 * la chiave, un file immagine rinominato lascia un rettangolo vuoto. Il
 * type-check prende solo il primo tipo di errore (le sette lingue); il
 * resto lo prendono questi test.
 *
 * `guide-ui.i18n.ts` non è verificato qui: finisce già nella rete di
 * `dictionaries.test.ts`, che importa ogni `*.i18n.ts` del web.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { GUIDE_CHAPTERS } from "@/app/setup-guide/guide-content";
import { SCREENS, pendingScreens } from "@/app/setup-guide/guide-screens";
import { OS_IDS, phasesFor, type GuideText } from "@/app/setup-guide/guide-types";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(HERE, "../../../web/public");

const LOCALES = ["it", "en", "es", "fr", "de", "pt", "hu"] as const;

/** Ogni testo visibile, con l'etichetta di dove sta — così un fallimento
 *  dice quale fase e quale campo, non «una stringa da qualche parte». */
function everyText(): { where: string; text: GuideText }[] {
  const out: { where: string; text: GuideText }[] = [];
  for (const chapter of GUIDE_CHAPTERS) {
    out.push({ where: `chapter ${chapter.id} · title`, text: chapter.title });
    out.push({
      where: `chapter ${chapter.id} · summary`,
      text: chapter.summary,
    });
    for (const phase of chapter.phases) {
      const at = `phase ${chapter.id}/${phase.id}`;
      out.push({ where: `${at} · title`, text: phase.title });
      out.push({ where: `${at} · body`, text: phase.body });
      if (phase.warning)
        out.push({ where: `${at} · warning`, text: phase.warning });
      if (phase.screen?.caption)
        out.push({ where: `${at} · caption`, text: phase.screen.caption });
      for (const [i, link] of (phase.links ?? []).entries())
        out.push({ where: `${at} · link[${i}]`, text: link.label });
    }
  }
  for (const screen of Object.values(SCREENS)) {
    out.push({ where: `screen ${screen.id} · alt`, text: screen.alt });
    out.push({ where: `screen ${screen.id} · caption`, text: screen.caption });
  }
  return out;
}

describe("guida di setup — traduzioni", () => {
  it("ogni testo esiste in tutte e sette le lingue, non vuoto", () => {
    const missing: string[] = [];
    for (const { where, text } of everyText()) {
      for (const locale of LOCALES) {
        if (!text[locale] || text[locale].trim() === "") {
          missing.push(`${where} → ${locale}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("nessuna lingua è una copia pigra dell'inglese sull'intera guida", () => {
    // Una singola stringa può legittimamente coincidere con l'inglese (nomi
    // propri, «FAQ»). Se però una lingua coincide su TUTTO, non è stata
    // tradotta: è l'inglese incollato sette volte.
    const texts = everyText();
    for (const locale of LOCALES) {
      if (locale === "en") continue;
      const identical = texts.filter(
        ({ text }) => text[locale] === text.en,
      ).length;
      expect(
        identical,
        `${locale}: ${identical}/${texts.length} testi identici all'inglese`,
      ).toBeLessThan(texts.length * 0.5);
    }
  });
});

describe("guida di setup — struttura", () => {
  it("gli id di capitoli e fasi sono unici", () => {
    const chapterIds = GUIDE_CHAPTERS.map((c) => c.id);
    expect(new Set(chapterIds).size).toBe(chapterIds.length);

    const phaseIds = GUIDE_CHAPTERS.flatMap((c) => c.phases.map((p) => p.id));
    expect(new Set(phaseIds).size).toBe(phaseIds.length);
  });

  it("ogni fase che dichiara una schermata la trova nel registro", () => {
    const dangling: string[] = [];
    for (const chapter of GUIDE_CHAPTERS) {
      for (const phase of chapter.phases) {
        if (phase.screen && !SCREENS[phase.screen.screenId]) {
          dangling.push(`${chapter.id}/${phase.id} → ${phase.screen.screenId}`);
        }
      }
    }
    expect(dangling).toEqual([]);
  });

  it("ogni sistema operativo ha un percorso completo", () => {
    // Nessun OS deve trovarsi un capitolo vuoto: se tutte le fasi di un
    // capitolo sono riservate ad altri sistemi, quel capitolo sparisce e la
    // guida salta un pezzo senza dirlo.
    for (const os of OS_IDS) {
      for (const chapter of GUIDE_CHAPTERS) {
        expect(
          phasesFor(chapter, os).length,
          `${os}: il capitolo ${chapter.id} non ha fasi`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("una schermata riusata in più fasi resta un asset solo", () => {
    // È il requisito esplicito: la stessa schermata può comparire in due
    // fasi. Il registro lo garantisce per costruzione (le fasi puntano a un
    // id), e questo test lo tiene vero — e verifica che il riuso esista
    // davvero, altrimenti nessuno si accorge se qualcuno duplica l'asset.
    const uses = new Map<string, number>();
    for (const chapter of GUIDE_CHAPTERS) {
      for (const phase of chapter.phases) {
        if (!phase.screen) continue;
        const id = phase.screen.screenId;
        uses.set(id, (uses.get(id) ?? 0) + 1);
      }
    }
    const reused = [...uses.entries()].filter(([, n]) => n > 1);
    expect(reused.length).toBeGreaterThan(0);
  });
});

describe("guida di setup — schermate", () => {
  it("ogni file dichiarato esiste davvero sotto public/", () => {
    const broken: string[] = [];
    for (const screen of Object.values(SCREENS)) {
      for (const [variant, asset] of Object.entries(screen.assets)) {
        if (!asset) continue;
        const onDisk = path.join(PUBLIC_DIR, asset.src);
        if (!fs.existsSync(onDisk)) {
          broken.push(`${screen.id}/${variant} → ${asset.src}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it("ogni schermata mancante dichiara cosa deve mostrare", () => {
    // L'elenco di ciò che manca si legge dal codice: una schermata senza
    // file e senza `pending` sparisce dai conti.
    const undocumented = pendingScreens()
      .filter((screen) => !screen.pending)
      .map((screen) => screen.id);
    expect(undocumented).toEqual([]);
  });
});
