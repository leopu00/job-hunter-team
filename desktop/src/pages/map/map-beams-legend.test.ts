import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { locales } from "@/i18n/config";
import { T } from "@/app/components/JobsGlobe.i18n";

const globe = readFileSync(resolve(process.cwd(), "../web/app/components/JobsGlobe.tsx"), "utf8");

// The beams' height and colour are the score, the number is the positions:
// without a key nobody can read them.
describe("the legend of the beams", () => {
  it("is written in every language and names both signs", () => {
    for (const lang of locales) {
      expect(T.beams_legend[lang], lang).toMatch(/=.*=/);
    }
  });

  it("is a pill above the control bar, not a chip inside it, from lg up", () => {
    // a chip in the bar pushed it under the corner panels at 1600 px
    expect(globe).toMatch(
      /displayData\.length > 0 && \(\s*<div\s+className="absolute inset-x-0 hidden lg:flex[^"]*"\s+style=\{\{ bottom: 76 \}\}\s*>\s*<p\s+className="[^"]*"\s+role="note"\s+data-testid="map-beams-legend"/,
    );
    expect(globe).toContain('tr("beams_legend")');
  });
});
