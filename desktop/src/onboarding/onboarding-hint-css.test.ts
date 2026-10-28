import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/onboarding/onboarding.css", "utf8").replace(/\r\n/g, "\n");

describe("a hint straight in the welcome panel", () => {
  it("is a block with room below: as an inline <small> its margin does nothing and the next label sits on it", () => {
    const rule = css.match(/\.onboarding-panel > \.onboarding-hint \{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toMatch(/display:\s*block/);
    expect(rule).toMatch(/margin:\s*\d+px 0 (1[2-9]|[2-9]\d)px/);
  });
});
