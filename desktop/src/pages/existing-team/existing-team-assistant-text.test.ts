import { describe, expect, it } from "vitest";
import { locales } from "@/i18n/config";
import { EXISTING_TEAM_ASSISTANT_TEXT } from "./existing-team-assistant.i18n";

// The words of the sentences «Attiva assistente» says, in every language: what the confirmation
// declares it creates on the team's VPS, and what a timeout tells the person to do (the refresh
// does not read the sessions, so it must not promise that it shows the assistant).
const REFRESH_WORDS: Record<string, RegExp> = {
  it: /aggiorna/i,
  en: /refresh/i,
  de: /aktualisier/i,
  fr: /actualis/i,
  es: /actualiz/i,
  pt: /atualiz/i,
  hu: /frissít/i,
};

describe("the sentences of «Attiva assistente», in every language", () => {
  it.each(locales)("%s: the confirmation declares the working folder, the user directory, and the locks and logs in /jht_home", (locale) => {
    const { effects } = EXISTING_TEAM_ASSISTANT_TEXT[locale];
    expect(effects).toContain("/jht_home");
    // what it still says: the provider's tokens, the welcome message, no provider change
    expect(effects).toContain("[WELCOME-USER]");
  });

  it.each(locales)("%s: the timeout says that trying the action again is safe, or reconnecting, and does not send to Refresh", (locale) => {
    const text = EXISTING_TEAM_ASSISTANT_TEXT[locale];
    expect(text.timedOut).not.toMatch(REFRESH_WORDS[locale]);
    // it names the action to try again, by its own label
    expect(text.timedOut).toContain(text.activate);
    // and keeps the code and the promise that nothing was enabled
    expect(text.timedOut).toContain("{code}");
  });

  it("is told differently in each language, not copied from another", () => {
    const sentences = locales.map((locale) => EXISTING_TEAM_ASSISTANT_TEXT[locale].timedOut);
    expect(new Set(sentences).size).toBe(locales.length);
    const effects = locales.map((locale) => EXISTING_TEAM_ASSISTANT_TEXT[locale].effects);
    expect(new Set(effects).size).toBe(locales.length);
  });
});
