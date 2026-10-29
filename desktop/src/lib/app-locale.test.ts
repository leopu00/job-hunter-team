import { afterEach, describe, expect, it } from "vitest";
import { appLocale, chooseAppLocale, explicitLocale, languagePickedAtStart, systemLocale } from "./app-locale";

describe("the language of the desktop", () => {
  afterEach(() => {
    document.cookie = "NEXT_LOCALE=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    localStorage.removeItem("jht-lang");
    localStorage.removeItem("jht-lang-picked");
  });

  it("follows the system language by its primary subtag", () => {
    expect(systemLocale(["it-IT"])).toBe("it");
    expect(systemLocale(["de-AT", "en-US"])).toBe("de");
    expect(systemLocale(["pt-BR"])).toBe("pt");
    expect(systemLocale(["HU"])).toBe("hu");
    expect(systemLocale(["fr_CA"])).toBe("fr");
  });

  it("takes the first system language the app has, and English when it has none", () => {
    expect(systemLocale(["ja-JP", "es-ES"])).toBe("es");
    expect(systemLocale(["ja-JP", "zh-CN"])).toBe("en");
    expect(systemLocale([])).toBe("en");
  });

  it("puts the person's own choice before the system's", () => {
    // vitest.setup.ts: the test system is Italian.
    expect(explicitLocale()).toBeNull();
    expect(appLocale()).toBe("it");
    localStorage.setItem("jht-lang", "fr");
    expect(appLocale()).toBe("fr");
    document.cookie = "NEXT_LOCALE=de";
    expect(appLocale()).toBe("de");
    document.cookie = "NEXT_LOCALE=xx";
    localStorage.setItem("jht-lang", "klingon");
    expect(appLocale()).toBe("it");
  });

  it("keeps the language said on the first screen as the person's own choice, and remembers that it was said there", () => {
    expect(languagePickedAtStart()).toBe(false);
    expect(chooseAppLocale("hu")).toBe(true);
    expect(explicitLocale()).toBe("hu");
    expect(appLocale()).toBe("hu");
    expect(document.cookie).toContain("NEXT_LOCALE=hu");
    expect(localStorage.getItem("jht-lang")).toBe("hu");
    expect(languagePickedAtStart()).toBe(true);
  });
});
