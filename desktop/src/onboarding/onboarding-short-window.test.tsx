import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// A beta tester on a 1366x768 laptop has an app window ~660 px tall: the first
// action of every setup step has to be on screen.
describe("the setup pages in a short window (CSS)", () => {
  const css = readFileSync(resolve(process.cwd(), "src/onboarding/onboarding.css"), "utf8");
  const artwork = readFileSync(resolve(process.cwd(), "src/onboarding/onboarding-artwork.css"), "utf8");

  it("shrinks the figure from 260 px to 150 px under 800 px of height", () => {
    expect(artwork).toMatch(/@media \(max-height: 800px\) \{\s*\.onboarding-artwork \{\s*width: min\(150px, 100%\);/);
  });

  it("drops the 610 px minimum height of the cards and the initial's tile under 800 px of height", () => {
    const block = css.match(/@media \(max-height: 800px\) \{([\s\S]*?)\n\}\n/)?.[1] ?? "";
    expect(block).toMatch(/\.onboarding-card,\s*\.onboarding-runtime-card \{\s*min-height: 0;/);
    expect(block).toMatch(/\.onboarding-account-mark \{\s*display: none;/);
  });
});
