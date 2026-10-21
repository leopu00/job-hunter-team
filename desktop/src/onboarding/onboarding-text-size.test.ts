// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SHEETS = {
  onboarding: new URL("./onboarding.css", import.meta.url),
  assistant: new URL("../pages/assistant-onboarding/assistant-onboarding.css", import.meta.url),
};

/** Every pixel size a sheet gives to text, with the rule that gives it. */
function pixelSizes(css: string): { selector: string; px: number }[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap((rule) => {
    const px = rule[2].match(/font-size:\s*([\d.]+)px/);
    return px ? [{ selector: rule[1].replace(/\/\*[\s\S]*?\*\//g, "").trim().replace(/\s+/g, " "), px: Number(px[1]) }] : [];
  });
}

describe("setup text size", () => {
  for (const [name, url] of Object.entries(SHEETS)) {
    const sizes = pixelSizes(readFileSync(url, "utf8"));

    it(`${name}: no text is set smaller than 11px`, () => {
      expect(sizes.length).toBeGreaterThan(0);
      expect(sizes.filter((rule) => rule.px < 11)).toEqual([]);
    });

    it(`${name}: errors and notices a person has to read are at least 12px`, () => {
      const messages = sizes.filter((rule) => /error|notice|hint|callout p|aside p/.test(rule.selector));
      expect(messages.length).toBeGreaterThan(0);
      expect(messages.filter((rule) => rule.px < 12)).toEqual([]);
    });
  }
});
