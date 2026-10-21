import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { LOCALES, loadRolePrompt } from "../src/parity/role-prompt.ts";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

// A VITALS alert used to go out on ONE CPU sample of 0.25 s, and the Capitano answered every
// one by retiring a scout: a team with no scouts left. The bridge now alerts only on sustained
// pressure the load confirms, and says so; the Capitano's safety exception says what a true
// emergency looks like, and that a single spike is never paid for with a retirement.
const RULE: Record<(typeof LOCALES)[number], string> = {
  en: "**A single spike is never paid for with a retirement**",
  it: "**Un picco singolo non si paga con un ritiro**",
  hu: "**Egyetlen csúcsért soha nem jár visszavonás**",
  es: "**Un pico aislado nunca se paga con una retirada**",
  de: "**Eine einzelne Spitze wird nie mit einem Rückzug bezahlt**",
  fr: "**Un pic isolé ne se paie jamais d'un retrait**",
  pt: "**Um pico isolado nunca se paga com uma retirada**",
};

describe("the Capitano and a CPU spike", () => {
  it.each(LOCALES)("%s: the safety exception reads the alert's duration and load, and never retires a worker for one spike", async (locale) => {
    const prompt = await loadRolePrompt({ appRoot: REPO_ROOT, role: "capitano", locale });
    const exception = prompt.identity.split("\n").find((line) => line.includes("`VITALS`/OOM"));
    expect(exception, locale).toBeDefined();
    // the same paragraph that says «act immediately» says what immediately is for
    expect(exception).toContain(RULE[locale]);
    // and it quotes what the bridge's alert says, so the two never drift apart
    expect(exception).toContain("over N consecutive samples (M min), load1 L on C cores");
  });
});
