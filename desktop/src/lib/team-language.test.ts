// @vitest-environment node
import { describe, expect, it } from "vitest";
import { shouldAskTeamLanguage, teamLanguageReply } from "./team-language";

describe("team language", () => {
  it("believes a reply only when both fields are one of the seven languages", () => {
    expect(teamLanguageReply({ locale: "it", stored: null })).toEqual({ locale: "it", stored: null });
    expect(teamLanguageReply({ locale: "pt", stored: "en", changed: true })).toEqual({ locale: "pt", stored: "en", changed: true });
    expect(teamLanguageReply({ locale: "it", stored: "it", changed: "yes" })).toEqual({ locale: "it", stored: "it" });
    for (const bad of [null, undefined, "it", 3, {}, { locale: "xx", stored: null }, { locale: "it", stored: "xx" }, { locale: "it" }, { locale: 1, stored: null }]) {
      expect(teamLanguageReply(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("asks only of a team that speaks English, in an app that does not", () => {
    const team = (locale: "en" | "it" | "hu") => ({ locale, stored: null });
    expect(shouldAskTeamLanguage(team("en"), "it")).toBe(true);
    expect(shouldAskTeamLanguage(team("en"), "en")).toBe(false);
    expect(shouldAskTeamLanguage(team("it"), "it")).toBe(false);
    expect(shouldAskTeamLanguage(team("hu"), "it")).toBe(false);
    expect(shouldAskTeamLanguage(null, "it")).toBe(false);
  });
});
