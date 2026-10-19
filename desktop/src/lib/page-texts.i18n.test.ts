// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ASSISTANT_GUIDE_TEXT } from "../pages/assistant-onboarding/AssistantOnboarding.guide.i18n";
import { OFFICE_TEXT } from "../office/office.i18n";
import { DICTATION_LOCALE, DIRECT_CHAT_TEXT } from "../pages/messages/direct-chat.i18n";
import { THEME_TEXT } from "../shell/theme.i18n";
import { HELP_TEXT } from "../pages/help/help.i18n";
import { SETTINGS_TEXT } from "../pages/settings/settings.i18n";
import { PROFILE_PAGE_TEXT } from "../pages/profile/profile-page.i18n";
import { VOICE_INPUT_TEXT } from "../voice-input/voice-input.i18n";
import { PAGE_STATES_TEXT } from "./page-states.i18n";

const LOCALES = ["it", "en", "de", "fr", "es", "pt", "hu"];

// Role names that are the same word in several languages.
const SAME_AS_ITALIAN = new Set(["Mentor", "Scout", "Scorer", "Sistema", "Team", "Assistente", "Analista", "Agente", "Capitano", "Tu", "pass", "Tema", "Grafite", "Oceano"]);

/** Every leaf string of a dictionary, with its path. */
function leaves(value: unknown, path = ""): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, inner]) => leaves(inner, path ? `${path}.${key}` : key));
}

describe.each([
  ["page states", PAGE_STATES_TEXT],
  ["direct chat", DIRECT_CHAT_TEXT],
  ["voice input", VOICE_INPUT_TEXT],
  ["profile page", PROFILE_PAGE_TEXT],
  ["office", OFFICE_TEXT],
  ["theme picker", THEME_TEXT],
  ["assistant onboarding", ASSISTANT_GUIDE_TEXT],
  ["settings page", SETTINGS_TEXT],
  ["help page", HELP_TEXT],
] as const)("the %s texts", (_name, dictionary) => {
  const dict = dictionary as Record<string, unknown>;

  it("cover the seven languages with the same keys as the Italian source", () => {
    expect(Object.keys(dict).sort()).toEqual([...LOCALES].sort());
    const keys = leaves(dict.it).map(([path]) => path);
    for (const locale of LOCALES) expect(leaves(dict[locale]).map(([path]) => path), locale).toEqual(keys);
  });

  it.each(LOCALES.filter((locale) => locale !== "it"))("%s: no empty text and no sentence left in Italian", (locale) => {
    const italian = new Map(leaves(dict.it));
    for (const [path, text] of leaves(dict[locale])) {
      expect(text.trim(), `${locale}.${path}`).not.toBe("");
      if (!SAME_AS_ITALIAN.has(text)) expect(text, `${locale}.${path} equals the Italian one`).not.toBe(italian.get(path));
    }
  });

  it("keep every {slot} wherever the Italian source has it", () => {
    const slotsOf = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
    const source = leaves(dict.it).filter(([, text]) => slotsOf(text).length > 0);
    for (const locale of LOCALES) {
      const own = new Map(leaves(dict[locale]));
      for (const [path, text] of source) expect(slotsOf(own.get(path) ?? ""), `${locale}.${path}`).toEqual(slotsOf(text));
    }
  });
});

describe("the dictation language", () => {
  it("has one speech locale per interface language", () => {
    expect(Object.keys(DICTATION_LOCALE).sort()).toEqual([...LOCALES].sort());
    expect(DICTATION_LOCALE.it).toBe("it-IT");
  });
});
