import { describe, expect, it } from "vitest";
import { locales } from "@/i18n/config";
import { firstName, greetingText, GREETING_TEXT, partOfDay } from "./greeting";

describe("the greeting", () => {
  it("follows the game's hours: 5–13 morning, 13–18 afternoon, the rest evening", () => {
    expect([4, 5, 12, 13, 17, 18, 23, 0].map(partOfDay)).toEqual(["evening", "morning", "morning", "afternoon", "afternoon", "evening", "evening", "evening"]);
  });

  it("says the first name in the person's language and says nothing while the name is not known", () => {
    expect(greetingText("Leone", 9, "it")).toBe("Buongiorno, Leone");
    expect(greetingText("Leone", 15, "en")).toBe("Good afternoon, Leone");
    expect(greetingText("Leone", 21, "pt")).toBe("Boa noite, Leone");
    expect(greetingText(null, 9, "it")).toBeNull();
  });

  it("every language greets in the three parts of the day with the name in it", () => {
    for (const locale of locales) {
      for (const part of ["morning", "afternoon", "evening"] as const) expect(GREETING_TEXT[locale][part], `${locale}.${part}`).toContain("{name}");
    }
  });

  it("the name is the first word of the profile's, as letters only", () => {
    expect(firstName("Leone Emanuele Puglisi")).toBe("Leone");
    expect(firstName("  Anne-Marie  Dupont")).toBe("Anne-Marie");
    expect(firstName("Zoë")).toBe("Zoë");
    expect(firstName("O’Brien")).toBe("O’Brien");
  });

  it("what is not a name greets nobody", () => {
    for (const bad of [null, undefined, "", "   ", "ada@example.invalid", "R2D2", "7", "<b>x</b>", "A".repeat(25)]) expect(firstName(bad), String(bad)).toBeNull();
  });
});
