import { afterEach, describe, expect, it } from "vitest";
import { appLocale, explicitLocale, systemLocale } from "./app-locale";

describe("the language of the desktop", () => {
  afterEach(() => {
    document.cookie = "NEXT_LOCALE=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    localStorage.removeItem("jht-lang");
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
});
