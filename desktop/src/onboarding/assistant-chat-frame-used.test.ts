// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("the Assistant's chat in the onboarding", () => {
  it("sits in the window-tall frame, never in a bare main with no height", () => {
    const source = readFileSync(new URL("../dashboard/DashboardApp.tsx", import.meta.url), "utf8");
    expect(source).toContain("<AssistantChatFrame");
    expect(source).not.toMatch(/<main[^>]*data-testid="onboarding-assistant-chat"/);
  });
});
