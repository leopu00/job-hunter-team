import { describe, expect, it } from "vitest";
import { DIRECT_CHAT_TEXT } from "./direct-chat.i18n";

describe("the direct chat's words for a turn that waits and a turn nobody took", () => {
  const locales = Object.keys(DIRECT_CHAT_TEXT) as Array<keyof typeof DIRECT_CHAT_TEXT>;

  it("has all seven languages", () => {
    expect([...locales].sort()).toEqual(["de", "en", "es", "fr", "hu", "it", "pt"]);
  });

  it.each(locales)("%s says «queued» and the not-taken line, and «queued» is not «delivered»", (locale) => {
    const t = DIRECT_CHAT_TEXT[locale];
    expect(t.queued.trim()).not.toBe("");
    expect(t.queued).not.toBe(t.delivered);
    expect(t.codes.mail_not_taken?.trim()).toBeTruthy();
  });

  it("says the not-taken line in each language, not the backend's English everywhere", () => {
    const english = DIRECT_CHAT_TEXT.en.codes.mail_not_taken;
    for (const locale of locales) {
      if (locale === "en") continue;
      expect(DIRECT_CHAT_TEXT[locale].codes.mail_not_taken).not.toBe(english);
    }
  });
});
