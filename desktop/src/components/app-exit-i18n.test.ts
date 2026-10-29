import { describe, expect, it } from "vitest";
import { locales } from "@/i18n/config";
import { SHELL_TEXT } from "../shell/shell.i18n";
import { APP_EXIT_TEXT } from "./AppExitDialog.i18n";

describe("AppExitDialog texts", () => {
  it("every language says every sentence", () => {
    const keys = Object.keys(APP_EXIT_TEXT.en).sort();
    for (const locale of locales) {
      expect(Object.keys(APP_EXIT_TEXT[locale]).sort(), locale).toEqual(keys);
      for (const key of keys) expect(APP_EXIT_TEXT[locale][key as keyof typeof APP_EXIT_TEXT.en].trim(), `${locale}.${key}`).not.toBe("");
    }
  });

  it("the waiting sentence has its slot in every language", () => {
    for (const locale of locales) expect(APP_EXIT_TEXT[locale].waiting, locale).toContain("{count}");
  });

  it("leaving the app and leaving the account are never the same word on the navbar", () => {
    for (const locale of locales) expect(APP_EXIT_TEXT[locale].menu, locale).not.toBe(SHELL_TEXT[locale].signOut);
  });

  it("the Italian ways out are «Esci da Job Hunter Team» and «Disconnetti»", () => {
    expect(APP_EXIT_TEXT.it.menu).toBe("Esci da Job Hunter Team");
    expect(SHELL_TEXT.it.signOut).toBe("Disconnetti");
  });
});
