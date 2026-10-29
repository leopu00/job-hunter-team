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

  it("ssh_unavailable is the sentence for an ssh that failed and said nothing, and tells what to check, in every language", () => {
    for (const locale of ERROR_LOCALES) {
      const described = describeError("ssh_unavailable", { locale });
      expect(described.known, locale).toBe(true);
      // The causes ssh names (key, refused connection, unreachable address, changed host key) have their own codes
      // and sentences now; this one is for the rest, and its action still lists what to check, not just "check the VPS".
      expect(described.action.split(/[,;:]/).length, locale).toBeGreaterThanOrEqual(3);
      expect(described.action.length, locale).toBeGreaterThan(80);
    }
    expect(describeError("ssh_unavailable", { locale: "en" }).text).toContain("cannot tell why");
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

  it.each([
    ["installer_digest_mismatch", "is not the one this version of the app expects", "aggiorna"],
    ["installer_payload_invalid", "is incomplete or damaged", "Riprova"],
  ])("%s has its own sentence in every language, not the generic integrity one", (code, english, italianAction) => {
    const generic = describeError("installer_digest_missing", { locale: "en" });
    expect(describeError(code, { locale: "en" }).text).toContain(english);
    expect(describeError(code, { locale: "it" }).action).toContain(italianAction);
    const seen = new Set<string>();
    for (const locale of ERROR_LOCALES) {
      const described = describeError(code, { locale });
      const genericHere = describeError("installer_digest_missing", { locale });
      expect(described.known, `${code}/${locale}`).toBe(true);
      expect(described.text, `${code}/${locale}`).not.toBe(genericHere.text);
      if (locale !== "en") expect(described.text, `${code}/${locale}`).not.toBe(generic.text);
      seen.add(described.text);
    }
    expect(seen.size).toBe(ERROR_LOCALES.length);
  });

  it("tells the two installer failures apart in every language", () => {
    for (const locale of ERROR_LOCALES) {
      const mismatch = describeError("installer_digest_mismatch", { locale });
      const payload = describeError("installer_payload_invalid", { locale });
      expect(mismatch.text, locale).not.toBe(payload.text);
      expect(mismatch.action, locale).not.toBe(payload.action);
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

  it("says in every language that the runtime may have been left on when the limit refuses a team start", () => {
    // the resume wakes the runtime before it reads the limits: a refusal leaves it running
    const words = { it: /runtime può essere rimasto acceso/, en: /runtime may have been left running/, de: /Laufzeit kann eingeschaltet geblieben sein/,
      es: /entorno de ejecución puede haber quedado encendido/, fr: /environnement d’exécution peut être resté allumé/,
      hu: /futtatókörnyezet bekapcsolva maradhatott/, pt: /ambiente de execução pode ter ficado ligado/ } as const;
    for (const locale of ERROR_LOCALES) {
      const now = new Date(2026, 9, 8, 10, 0);
      const { action } = describeError("provider_limits_exhausted", { locale, resetsAt: Math.floor(now.getTime() / 1000) + 3600, now: now.getTime() });
      expect(action, locale).toMatch(words[locale]);
      expect(action, locale).not.toMatch(/niente|Nothing|nichts|nada|Rien|Semmi|Nada/i);
    }
  });
});
