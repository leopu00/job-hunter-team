import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { locales } from "@/i18n/config";
import { T } from "@/app/components/JobsGlobe.i18n";

const globe = readFileSync(resolve(process.cwd(), "../web/app/components/JobsGlobe.tsx"), "utf8");

// A globe with no beam on it used to be only a background: nothing said why.
describe("the empty map says so", () => {
  it("is written in every language of the app, and says more than the title", () => {
    for (const lang of locales) {
      expect(T.empty_title[lang].length, `title ${lang}`).toBeGreaterThan(10);
      expect(T.empty_hint[lang].length, `hint ${lang}`).toBeGreaterThan(T.empty_title[lang].length);
    }
    // the sentence is a promise about the remote ring: it must be the same ring the legend names
    expect(T.empty_hint.en).toContain("blue ring");
    expect(T.remote_legend.en).toContain("Blue ring");
  });

  it("is drawn once the positions are loaded and there are none, never on the landing showcase", () => {
    expect(globe).toMatch(/\{loaded && data\.length === 0 && !showcase && \(/);
    expect(globe).toContain('data-testid="map-empty-state"');
    expect(globe).toContain('tr("empty_title")');
    expect(globe).toContain('tr("empty_hint")');
  });
});
