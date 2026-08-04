import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const repo = path.resolve(__dirname, "../../..");
const launcher = fs.readFileSync(
  path.join(repo, "e2e/scripts/open-recording-browser.mjs"),
  "utf8",
);
const e2ePackage = JSON.parse(
  fs.readFileSync(path.join(repo, "e2e/package.json"), "utf8"),
) as { scripts: Record<string, string> };

describe("launcher Playwright per riprese web", () => {
  it("espone un comando dedicato per il browser visible", () => {
    expect(e2ePackage.scripts["recording-browser"]).toBe(
      "node scripts/open-recording-browser.mjs",
    );
  });

  it("applica lo storage state a un Chromium kiosk effimero", () => {
    expect(launcher).toContain('import { chromium } from "@playwright/test"');
    expect(launcher).toContain("storageState,");
    expect(launcher).toContain("headless: false");
    expect(launcher).toContain('args: ["--kiosk"]');
    expect(launcher).toContain("viewport: null");
    expect(launcher).not.toContain("launchPersistentContext");
  });

  it("prepara il frame prima della navigazione senza mutare il server", () => {
    const setup = launcher.slice(
      launcher.indexOf("await context.clearCookies"),
      launcher.indexOf("const response = await page.goto"),
    );

    expect(setup).toContain('name: "jht_demo_persona"');
    expect(setup).toContain('localStorage.setItem("jht-theme", "light")');
    expect(setup).toContain('localStorage.setItem("jht-tour-done", "1")');
    expect(launcher).toContain('new URL("/dashboard", url)');
    expect(launcher).toContain("url.origin !== LOCAL_RECORDING_ORIGIN");
    expect(launcher).not.toMatch(
      /\b(?:fetch|request\.(?:post|put|patch|delete))\b/,
    );
  });
});
