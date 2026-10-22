// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("./existing-team-connect.css", import.meta.url), "utf8");

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return styles.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}

describe("the connect dialog on a short window", () => {
  it("scrolls inside itself, and keeps its buttons on the bottom edge of what is visible", () => {
    expect(rule(".existing-team-modal")).toMatch(/max-height:\s*min\(820px,\s*calc\(100dvh - 56px\)\)/);
    expect(rule(".existing-team-modal")).toMatch(/overflow:\s*auto/);
    expect(rule(".existing-team-modal__actions")).toMatch(/position:\s*sticky/);
    expect(rule(".existing-team-modal__actions")).toMatch(/bottom:\s*0/);
    // opaque, or the text scrolling under it shows through the buttons
    expect(rule(".existing-team-modal__actions")).toMatch(/background:\s*var\(--color-panel/);
  });

  it("drops the picture under 700px of height, before the form or the buttons", () => {
    expect(styles).toMatch(/@media \(max-height: 700px\) \{[\s\S]*?\.existing-team-modal__artwork \{ display: none; \}/);
  });
});
