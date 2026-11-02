import { describe, expect, it } from "vitest";
import { locales } from "@/i18n/config";
import { SECTIONS_TEXT } from "../pages/settings/settings-sections.i18n";
import { NAV_TEXT } from "./nav.i18n";

describe("the words of the navbar and of the settings sections", () => {
  it.each([
    ["navbar", NAV_TEXT],
    ["settings sections", SECTIONS_TEXT],
  ] as const)("%s: are written in the seven languages with the same keys, none empty", (_name, texts) => {
    expect(Object.keys(texts).sort()).toEqual([...locales].sort());
    for (const locale of locales) {
      const entry = texts[locale] as unknown as Record<string, string>;
      expect(Object.keys(entry).sort(), locale).toEqual(Object.keys(texts.it).sort());
      for (const [key, value] of Object.entries(entry)) expect(value.trim().length, `${locale}.${key}`).toBeGreaterThan(1);
    }
  });

  it("do not leave the other languages with the Italian words", () => {
    for (const locale of locales.filter((l) => l !== "it")) {
      expect(SECTIONS_TEXT[locale].where, locale).not.toBe(SECTIONS_TEXT.it.where);
      expect(SECTIONS_TEXT[locale].appearance, locale).not.toBe(SECTIONS_TEXT.it.appearance);
      expect(NAV_TEXT[locale].settings, locale).not.toBe(NAV_TEXT.it.settings);
    }
  });

  it("keep the Portuguese of Portugal: «equipa», «secções»", () => {
    expect(SECTIONS_TEXT.pt.team).toBe("Equipa");
    expect(JSON.stringify(SECTIONS_TEXT.pt)).not.toMatch(/equipe|seções/i);
  });
});
