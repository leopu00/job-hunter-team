import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// A beta tester on a 1366x768 laptop has an app window ~660 px tall: the first
// action of every setup step has to be on screen.
// On Windows a checkout turns the CSS's line ends into CRLF (no eol=lf for .css
// in .gitattributes): a pattern that looks for "\n}\n" then finds nothing.
// The text is read with its line ends normalised, like a person reads it.
const lf = (text: string) => text.replace(/\r\n/g, "\n");
const readCss = (name: string) => lf(readFileSync(resolve(process.cwd(), `src/onboarding/${name}`), "utf8"));
const shortWindowBlock = (css: string) => css.match(/@media \(max-height: 800px\) \{([\s\S]*?)\n\}\n/)?.[1] ?? "";

describe("the setup pages in a short window (CSS)", () => {
  const css = readCss("onboarding.css");
  const artwork = readCss("onboarding-artwork.css");

  it("shrinks the figure from 260 px to 150 px under 800 px of height", () => {
    expect(artwork).toMatch(/@media \(max-height: 800px\) \{\s*\.onboarding-artwork \{\s*width: min\(150px, 100%\);/);
  });

  it("drops the 610 px minimum height of the cards and the initial's tile under 800 px of height", () => {
    const block = shortWindowBlock(css);
    expect(block).toMatch(/\.onboarding-card,\s*\.onboarding-runtime-card \{\s*min-height: 0;/);
    expect(block).toMatch(/\.onboarding-account-mark \{\s*display: none;/);
  });

  it("finds the same block when the file has Windows line ends (CRLF)", () => {
    const crlf = css.replace(/\n/g, "\r\n");
    expect(shortWindowBlock(lf(crlf))).not.toBe("");
    expect(shortWindowBlock(lf(crlf))).toBe(shortWindowBlock(css));
    // what the Windows job saw before: the same text, not normalised, gives an empty block
    expect(shortWindowBlock(crlf)).toBe("");
  });
});
