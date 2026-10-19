import { describe, expect, it } from "vitest";
import { fitCount } from "./nav-fit";

// Measured in a real Chrome on the full shell (ten links: Dashboard, Map,
// Positions, Swipe, Team, Messages, Profile, Agents, Office, Mail): the links'
// own widths at 1512 px, and the strip's width at 1068 and at 1512 px.
const WIDTHS = [93, 47, 93, 63, 55, 86, 78, 70, 70, 55];
const STRIP_1068 = 635;
const STRIP_1512 = 1005;
const GAP = 4;
const MORE = 72;

describe("how many navbar links fit", () => {
  it("keeps the first seven at 1068 px and sends Agents, Office and Mail to the menu (as seen in the browser)", () => {
    expect(fitCount(WIDTHS, GAP, STRIP_1068, MORE)).toBe(7);
  });

  it("shows all ten at 1512 px, with no room kept for a menu", () => {
    expect(fitCount(WIDTHS, GAP, STRIP_1512, MORE)).toBe(10);
  });

  it("never lets the shown links and the menu button together exceed the strip, whatever the number of links", () => {
    for (let count = 1; count <= 25; count++) {
      const widths = Array.from({ length: count }, (_unused, i) => 55 + ((i * 17) % 50));
      for (const strip of [320, 635, 760, 1005]) {
        const shown = fitCount(widths, GAP, strip, MORE);
        if (shown === count) {
          const total = widths.reduce((a, b) => a + b, 0) + GAP * (count - 1);
          expect(total, `${count} links in ${strip}`).toBeLessThanOrEqual(strip);
        } else {
          const used = MORE + widths.slice(0, shown).reduce((a, b) => a + b + GAP, 0);
          expect(used, `${count} links in ${strip}`).toBeLessThanOrEqual(strip);
          // and the next one really would not have fit
          expect(used + widths[shown] + GAP, `${count} links in ${strip}`).toBeGreaterThan(strip);
        }
      }
    }
  });

  it("is the same for a longer language: wider links mean more in the menu, not a cut link", () => {
    const german = WIDTHS.map((w) => Math.round(w * 1.3));
    expect(fitCount(german, GAP, STRIP_1068, MORE)).toBeLessThan(fitCount(WIDTHS, GAP, STRIP_1068, MORE));
  });

  it("shows nothing but the menu in a strip with no room, and everything where there is no layout at all", () => {
    expect(fitCount(WIDTHS, GAP, 40, MORE)).toBe(0);
    expect(fitCount(WIDTHS.map(() => 0), GAP, 0, MORE)).toBe(10);
    expect(fitCount(WIDTHS, GAP, 0, MORE)).toBe(10);
  });
});
