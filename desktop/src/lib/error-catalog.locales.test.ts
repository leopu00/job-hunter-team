// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ERROR_CATALOG, describeError } from "./error-catalog";
import {
  ERROR_CATALOG_LOCALES,
  ERROR_TRANSLATION_LOCALES,
} from "./error-catalog.locales";

describe("localized desktop error catalog", () => {
  it("has all five translations for every catalog code, with no stale code", () => {
    expect(Object.keys(ERROR_CATALOG_LOCALES).sort()).toEqual(
      Object.keys(ERROR_CATALOG).sort(),
    );
  });

  it("writes every translated entry in all five additional product languages", () => {
    expect(ERROR_TRANSLATION_LOCALES).toEqual(["de", "es", "fr", "hu", "pt"]);

    for (const [code, translations] of Object.entries(ERROR_CATALOG_LOCALES)) {
      expect(Object.keys(translations).sort(), code).toEqual(
        [...ERROR_TRANSLATION_LOCALES].sort(),
      );

      for (const locale of ERROR_TRANSLATION_LOCALES) {
        const [text, action] = translations[locale];
        for (const value of [text, action]) {
          expect(value.trim().length, `${code}/${locale}`).toBeGreaterThan(8);
          expect(value, `${code}/${locale}`).not.toMatch(/\b[a-z]+_[a-z0-9_]+\b/);
          expect(value, `${code}/${locale}`).toMatch(/[.!?]$/);
        }
      }
    }
  });

  it("returns each requested product language instead of falling back to English", () => {
    for (const locale of ERROR_TRANSLATION_LOCALES) {
      const described = describeError("agent_busy", { locale });
      expect(described.text).toBe(ERROR_CATALOG_LOCALES.agent_busy[locale][0]);
      expect(described.action).toBe(ERROR_CATALOG_LOCALES.agent_busy[locale][1]);
      expect(described.text).not.toBe(ERROR_CATALOG.agent_busy.text.en);
    }
  });
});
