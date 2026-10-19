import { describe, expect, it } from "vitest";
import { SHELL_TEXT } from "./shell.i18n";

const LOCALES = ["it", "en", "de", "hu", "es", "fr", "pt"] as const;

describe("the shell's own words", () => {
  it("are written in all seven languages", () => {
    expect(Object.keys(SHELL_TEXT).sort()).toEqual([...LOCALES].sort());
    for (const locale of LOCALES) {
      const t = SHELL_TEXT[locale];
      for (const word of [t.navAria, t.refresh, t.signOut, t.signingOut, t.signOutFailed]) {
        expect(word.trim().length, `${locale}`).toBeGreaterThan(0);
      }
    }
  });

  it("keep the Italian wording the app had before", () => {
    const it = SHELL_TEXT.it;
    expect([it.navAria, it.refresh, it.signOut, it.signingOut]).toEqual(["Navigazione app", "Aggiorna", "Esci", "Uscita…"]);
    expect(it.pageReadFailed("Aggiorna")).toBe("Non riesco a leggere questa pagina. Controlla la connessione e premi «Aggiorna».");
  });

  it("tell a page that could not be read with the label of the button that reads it again", () => {
    for (const locale of LOCALES) {
      const t = SHELL_TEXT[locale];
      expect(t.pageReadFailed(t.refresh), locale).toContain(t.refresh);
    }
  });

  it("do not leave the English app with Italian buttons", () => {
    const en = SHELL_TEXT.en;
    for (const word of [en.refresh, en.signOut, en.signingOut]) expect(word).not.toMatch(/Aggiorna|Esci|Uscita/);
  });
});
