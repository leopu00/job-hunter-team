import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/components/login-screen.css", "utf8");

describe("login identity layout", () => {
  it("uses a balanced horizontal composition at the captured desktop viewport", () => {
    expect(css).toMatch(/width:\s*min\(1180px,\s*100%\)/);
    expect(css).toMatch(/grid-template-columns:\s*minmax\(240px,\s*\.88fr\)\s+minmax\(280px,\s*1\.12fr\)/);
    expect(css).toMatch(/\.login-card__artwork\s*\{[^}]*width:\s*min\(560px,\s*100%\)[^}]*grid-column:\s*2/s);
  });

  it("keeps 820px horizontal and collapses only below the narrow breakpoint", () => {
    expect(css).toMatch(/@media\s*\(max-width:\s*760px\)/);
    expect(css).not.toMatch(/@media\s*\(max-width:\s*8(?:20|19|18)px\)/);
    expect(css).toMatch(/@media\s*\(max-width:\s*480px\)/);
    expect(css).toMatch(/@media\s*\(max-width:\s*760px\)[\s\S]*grid-template-columns:\s*1fr/);
  });

  it("contains artwork and allows vertical overflow only when the viewport needs it", () => {
    expect(css).toMatch(/\.login-screen\s*\{[^}]*overflow:\s*auto/s);
    expect(css).toMatch(/min-height:\s*calc\(100vh\s*\/\s*var\(--zoom,\s*1\)\)/);
    const artworkCss = readFileSync("src/onboarding/onboarding-artwork.css", "utf8");
    expect(artworkCss).toMatch(/object-fit:\s*contain/);
  });
});
