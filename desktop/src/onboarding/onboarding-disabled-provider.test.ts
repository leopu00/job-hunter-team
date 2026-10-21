// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("a provider the platform cannot offer", () => {
  it("looks disabled: dimmed, dashed, no hover lift (the markup part is in OnboardingFlow.test.tsx)", () => {
    const css = readFileSync(new URL("./onboarding.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.onboarding-choice:disabled \{[^}]*opacity: 0\.5;[^}]*cursor: not-allowed;/);
    expect(css).toMatch(/\.onboarding-choice:hover:not\(:disabled\)/);
  });
});
