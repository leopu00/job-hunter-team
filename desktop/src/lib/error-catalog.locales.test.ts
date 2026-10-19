// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ERROR_CATALOG, ERROR_LOCALES, describeError } from "./error-catalog";
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

  it("ssh_unavailable lists the likely causes and what to check in every language", () => {
    for (const locale of ERROR_LOCALES) {
      const described = describeError("ssh_unavailable", { locale });
      expect(described.known, locale).toBe(true);
      // Five causes in the sentence (passphrase or open permissions, wrong
      // user, unauthorized key, closed port, timeout), not just "check the VPS".
      expect(described.text.split(/[,;:]/).length, locale).toBeGreaterThanOrEqual(5);
      expect(described.action.length, locale).toBeGreaterThan(80);
    }
    expect(describeError("ssh_unavailable", { locale: "it" }).text).toContain("passphrase");
  });

  it("ssh_client_missing has its own sentence and says to install OpenSSH in every language", () => {
    for (const locale of ERROR_LOCALES) {
      const described = describeError("ssh_client_missing", { locale });
      expect(described.known, locale).toBe(true);
      expect(described.text, locale).toContain("OpenSSH");
      expect(described.action, locale).toContain("OpenSSH");
      expect(described.text, locale).not.toBe(describeError("ssh_unavailable", { locale }).text);
    }
  });

  it("ssh_rate_limited says to wait and try once, in every language, and is not the generic SSH sentence", () => {
    for (const locale of ERROR_LOCALES) {
      const described = describeError("ssh_rate_limited", { locale });
      expect(described.known, locale).toBe(true);
      expect(described.text, locale).not.toBe(describeError("ssh_unavailable", { locale }).text);
      expect(described.action.length, locale).toBeGreaterThan(40);
    }
    expect(describeError("ssh_rate_limited", { locale: "it" }).action).toContain("dieci minuti");
  });

  it("returns each requested product language instead of falling back to English", () => {
    for (const locale of ERROR_TRANSLATION_LOCALES) {
      const described = describeError("agent_busy", { locale });
      expect(described.text).toBe(ERROR_CATALOG_LOCALES.agent_busy[locale][0]);
      expect(described.action).toBe(ERROR_CATALOG_LOCALES.agent_busy[locale][1]);
      expect(described.text).not.toBe(ERROR_CATALOG.agent_busy.text.en);
    }
  });

  it("names the next day in every product language when a limit resets after midnight", () => {
    const now = new Date(2026, 9, 8, 23, 30);
    const resetsAt = Math.floor(now.getTime() / 1000) + 2 * 3600;
    const resetDate = new Date(resetsAt * 1000);
    const tags = {
      it: "it-IT", en: "en-GB", de: "de-DE", es: "es-ES", fr: "fr-FR", hu: "hu-HU", pt: "pt-PT",
    } as const;

    for (const locale of ERROR_LOCALES) {
      const day = new Intl.DateTimeFormat(tags[locale], {
        weekday: "long", day: "numeric", month: "long",
      }).format(resetDate);
      const described = describeError("provider_limits_exhausted", {
        locale,
        resetsAt,
        now: now.getTime(),
      });

      expect(described.text, locale).toContain(day);
      expect(described.action, locale).toContain(day);
    }
  });
});
