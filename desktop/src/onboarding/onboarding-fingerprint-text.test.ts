import { describe, expect, it } from "vitest";
import { ONBOARDING_TEXT } from "./onboarding.i18n";

describe("the fingerprint says what to do", () => {
  it("is called «impronta» in Italian, like everywhere else in the app, not «fingerprint»", () => {
    const it = ONBOARDING_TEXT.it;
    expect(it.hostKeyTitle).toBe("Controlla l’impronta del server");
    expect(it.confirmFingerprint).toBe("Conferma l’impronta");
    expect(it.fingerprint).toBe("Impronta");
  });

  it("tells every language to press Cancel when it differs, naming the real button", () => {
    for (const [locale, text] of Object.entries(ONBOARDING_TEXT)) {
      expect(text.hostKeyText, locale).toContain(text.cancel);
    }
  });
});
