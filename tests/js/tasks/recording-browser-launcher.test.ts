import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  ALLOWED_RECORDING_ROUTES,
  createGetOnlyRequestPolicy,
  recordingTarget,
} from "../../../e2e/scripts/recording-browser-policy.mjs";

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
    expect(setup).not.toMatch(/(?:createElement\("style"|querySelector|locator)/);
    expect(launcher).toContain('await context.route("**/*", getOnly.handle)');
    expect(launcher.match(/page\.goto\(/g)).toHaveLength(1);
    expect(launcher).not.toContain("BASE_URL");
    expect(launcher).toContain("if (page.url() !== target)");
    expect(launcher.indexOf("target = recordingTarget()")).toBeLessThan(
      launcher.indexOf("browser = await chromium.launch"),
    );
    expect(launcher).not.toMatch(
      /\b(?:fetch|request\.(?:post|put|patch|delete))\b/,
    );
  });

  it("accetta solo le due route recording esatte sull'origin fisso", () => {
    expect([...ALLOWED_RECORDING_ROUTES]).toEqual(["/dashboard", "/messages"]);
    expect(recordingTarget("/dashboard")).toBe(
      "http://localhost:3008/dashboard",
    );
    expect(recordingTarget("/messages")).toBe(
      "http://localhost:3008/messages",
    );
  });

  it("rifiuta route non canoniche prima di avviare Chromium", () => {
    for (const route of [
      "https://localhost:3008/dashboard",
      "http://example.test/messages",
      "//localhost:3008/dashboard",
      "/dashboard?take=1",
      "/messages#thread",
      "/dashboard/",
      "/messages/../dashboard",
      "/positions",
    ]) {
      expect(() => recordingTarget(route)).toThrow(
        "JHT_RECORDING_PATH deve essere esattamente",
      );
    }
  });

  it("rifiuta l'env ROUTE revocata invece di aprire il dashboard di default", () => {
    const previous = process.env.JHT_RECORDING_ROUTE;
    process.env.JHT_RECORDING_ROUTE = "/messages";
    try {
      expect(() => recordingTarget()).toThrow(
        "JHT_RECORDING_ROUTE non e' supportata",
      );
    } finally {
      if (previous === undefined) delete process.env.JHT_RECORDING_ROUTE;
      else process.env.JHT_RECORDING_ROUTE = previous;
    }
  });

  it("lascia passare GET e blocca una POST facendo fallire il take", async () => {
    const logs: string[] = [];
    const policy = createGetOnlyRequestPolicy((message) => logs.push(message));
    const get = {
      request: () => ({ method: () => "GET" }),
      continue: async () => undefined,
      abort: async () => undefined,
    };
    await policy.handle(get);

    let aborted = false;
    const post = {
      request: () => ({ method: () => "POST" }),
      continue: async () => undefined,
      abort: async () => {
        aborted = true;
      },
    };
    const failedTake = expect(policy.violation).rejects.toThrow(
      "policy GET-only violata: richiesta POST bloccata",
    );
    await policy.handle(post);
    await failedTake;

    expect(aborted).toBe(true);
    expect(logs).toEqual([
      "✗ policy GET-only violata: richiesta POST bloccata; take fallito.",
    ]);
  });
});
