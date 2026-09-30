// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("./assistant-onboarding.css", import.meta.url), "utf8");

describe("AssistantOnboarding responsive CSS", () => {
  it("switches to one column before the global desktop zoom can force horizontal overflow", () => {
    expect(styles).toContain("@media (max-width: 960px)");
    expect(styles).toMatch(/@media \(max-width: 960px\)[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
  });
});
