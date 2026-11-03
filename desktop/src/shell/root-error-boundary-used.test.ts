// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// B1: a render error in a screen with no shell around it (the setup) left the window blank. The root keeps a boundary.
describe("the app's root", () => {
  it("draws App inside the page error boundary and starts again from its home button", () => {
    const source = readFileSync(new URL("../main.tsx", import.meta.url), "utf8");
    expect(source).toMatch(/<PageErrorBoundary onHome=\{\(\) => window\.location\.reload\(\)\}>\s*<App \/>\s*<\/PageErrorBoundary>/);
  });
});
