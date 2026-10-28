import { describe, expect, it } from "vitest";
import { LOCAL_PROFILES_TEXT } from "./local-profiles.i18n";

const LOCALES = Object.keys(LOCAL_PROFILES_TEXT) as (keyof typeof LOCAL_PROFILES_TEXT)[];

describe("the words of the list of local profiles", () => {
  it("are in the seven languages", () => {
    expect(LOCALES.sort()).toEqual(["de", "en", "es", "fr", "hu", "it", "pt"]);
  });

  it.each(LOCALES)("%s: every key has a text, and the same keys as Italian", (locale) => {
    const keys = Object.keys(LOCAL_PROFILES_TEXT.it);
    expect(Object.keys(LOCAL_PROFILES_TEXT[locale])).toEqual(keys);
    for (const key of keys) {
      expect((LOCAL_PROFILES_TEXT[locale] as Record<string, string>)[key].trim(), key).not.toBe("");
    }
  });

  it.each(LOCALES)("%s: the sentences with a name have the place for it, the others do not", (locale) => {
    const text = LOCAL_PROFILES_TEXT[locale];
    expect(text.useProfile).toContain("{name}");
    expect(text.ownerBanner).toContain("{name}");
    expect(text.ownerBannerUnknown).not.toContain("{name}");
    expect(text.ownerBannerAccount).not.toContain("{name}");
  });

  it.each(LOCALES)("%s: the small labels and buttons fit the places they are in", (locale) => {
    const text = LOCAL_PROFILES_TEXT[locale];
    expect(text.listTitle.length).toBeLessThanOrEqual(30);
    expect(text.teamHere.length).toBeLessThanOrEqual(24);
    expect(text.lastUsed.length).toBeLessThanOrEqual(16);
    expect(text.newProfile.length).toBeLessThanOrEqual(28);
    expect(text.switchProfile.length).toBeLessThanOrEqual(20);
  });
});
