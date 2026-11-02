import { describe, expect, it } from "vitest";
import { locales } from "@/i18n/config";
import { officeText } from "../office.i18n";

const KEYS = [
  "agentPanelAria", "agentActionsAria", "heldByYou", "heldBySafety", "notRunning", "notPublishedHere", "sectionQuestions",
  "questionsNone", "sectionLastMessage", "lastFromYou", "lastNone", "writeTo", "terminalToggle", "terminalLogAria", "detailsUnavailable",
] as const;

describe("the agent panel's words, in the 7 languages", () => {
  it.each(locales)("%s: every text is there, and the ones that name the agent say where", (locale) => {
    const t = officeText(locale);
    for (const key of KEYS) expect(t[key].trim().length, `${locale} ${key}`).toBeGreaterThan(1);
    for (const key of ["agentPanelAria", "agentActionsAria", "writeTo", "terminalLogAria"] as const) expect(t[key], `${locale} ${key}`).toContain("{name}");
    expect(t.questionsOpen.other, locale).toContain("{count}");
    expect(t.questionsOpen.one ?? t.questionsOpen.other, locale).toContain("{count}");
  });

  it("a text is never the Italian one in another language, but for the words that are the same", () => {
    const it = officeText("it");
    const same = new Set(["lastFromYou"]);
    for (const locale of locales.filter((l) => l !== "it")) {
      for (const key of KEYS) if (!same.has(key)) expect(officeText(locale)[key], `${locale} ${key}`).not.toBe(it[key]);
    }
  });
});
