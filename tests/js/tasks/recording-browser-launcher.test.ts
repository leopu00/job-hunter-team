import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  ALLOWED_RECORDING_ROUTES,
  createGetOnlyRequestPolicy,
  recordingTarget,
  SYNTHETIC_POSITION_SEEN_BODY,
  SYNTHETIC_POSITION_RECORDING_ROUTE,
  SYNTHETIC_POSITION_SEEN_URL,
} from "../../../e2e/scripts/recording-browser-policy.mjs";

const repo = path.resolve(__dirname, "../../..");
const launcher = fs.readFileSync(
  path.join(repo, "e2e/scripts/open-recording-browser.mjs"),
  "utf8",
);
const e2ePackage = JSON.parse(
  fs.readFileSync(path.join(repo, "e2e/package.json"), "utf8"),
) as { scripts: Record<string, string> };

function interceptedRoute({
  method,
  url = "http://localhost:3008/asset.js",
  body = null,
}: {
  method: string;
  url?: string;
  body?: string | null;
}) {
  let continued = false;
  let aborted = false;
  return {
    route: {
      request: () => ({
        method: () => method,
        url: () => url,
        postData: () => body,
      }),
      continue: async () => {
        continued = true;
      },
      abort: async () => {
        aborted = true;
      },
    },
    get continued() {
      return continued;
    },
    get aborted() {
      return aborted;
    },
  };
}

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
    expect(setup).not.toMatch(
      /(?:createElement\("style"|querySelector|locator)/,
    );
    expect(launcher).toContain('await context.route("**/*", getOnly.handle)');
    expect(launcher.match(/page\.goto\(/g)).toHaveLength(1);
    expect(launcher).not.toContain("BASE_URL");
    expect(launcher).toContain("if (page.url() !== target)");
    expect(launcher).toContain("getOnly.allowedSeenPost");
    expect(launcher).toContain("getOnly.seenPostCount !== 1");
    expect(launcher.indexOf("target = recordingTarget()")).toBeLessThan(
      launcher.indexOf("browser = await chromium.launch"),
    );
    expect(launcher).not.toMatch(
      /\b(?:fetch|request\.(?:post|put|patch|delete))\b/,
    );
  });

  it("accetta solo le route recording esatte sull'origin fisso", () => {
    expect([...ALLOWED_RECORDING_ROUTES]).toEqual([
      "/dashboard",
      "/messages",
      "/positions/9001",
    ]);
    expect(recordingTarget("/dashboard")).toBe(
      "http://localhost:3008/dashboard",
    );
    expect(recordingTarget("/messages")).toBe("http://localhost:3008/messages");
    expect(recordingTarget("/positions/9001")).toBe(
      "http://localhost:3008/positions/9001",
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
      "/positions/9002",
      "/positions/9001/",
      "/positions/9001?take=1",
      "/positions/9001#overview",
      "/positions/%39%30%30%31",
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
    const get = interceptedRoute({ method: "GET" });
    await policy.handle(get.route);

    const post = interceptedRoute({ method: "POST" });
    let abortedBeforeFailure = false;
    void policy.violation.catch(() => {
      abortedBeforeFailure = post.aborted;
    });
    const failedTake = expect(policy.violation).rejects.toThrow(
      "policy GET-only violata: richiesta POST bloccata",
    );
    await policy.handle(post.route);
    await failedTake;

    expect(get.continued).toBe(true);
    expect(post.aborted).toBe(true);
    expect(abortedBeforeFailure).toBe(true);
    expect(logs).toEqual([
      "✗ policy GET-only violata: richiesta POST bloccata; take fallito.",
    ]);
  });

  it("aborta una sola POST seen sintetica esatta senza far fallire il take", async () => {
    const logs: string[] = [];
    const policy = createGetOnlyRequestPolicy(
      (message) => logs.push(message),
      SYNTHETIC_POSITION_RECORDING_ROUTE,
    );
    const seen = interceptedRoute({
      method: "POST",
      url: SYNTHETIC_POSITION_SEEN_URL,
      body: SYNTHETIC_POSITION_SEEN_BODY,
    });

    await policy.handle(seen.route);
    await policy.allowedSeenPost;

    expect(seen.aborted).toBe(true);
    expect(seen.continued).toBe(false);
    expect(policy.seenPostCount).toBe(1);
    expect(logs).toEqual(["✓ marker seen sintetico abortito; take prosegue."]);

    const get = interceptedRoute({ method: "GET" });
    await policy.handle(get.route);
    expect(get.continued).toBe(true);
  });

  it("rende fatale una seconda POST seen esatta, perche' il contatore sarebbe due", async () => {
    const policy = createGetOnlyRequestPolicy(
      console.error,
      SYNTHETIC_POSITION_RECORDING_ROUTE,
    );
    const first = interceptedRoute({
      method: "POST",
      url: SYNTHETIC_POSITION_SEEN_URL,
      body: SYNTHETIC_POSITION_SEEN_BODY,
    });
    await policy.handle(first.route);

    const second = interceptedRoute({
      method: "POST",
      url: SYNTHETIC_POSITION_SEEN_URL,
      body: SYNTHETIC_POSITION_SEEN_BODY,
    });
    const failedTake = expect(policy.violation).rejects.toThrow(
      "policy GET-only violata: richiesta POST bloccata",
    );
    await policy.handle(second.route);
    await failedTake;

    expect(first.aborted).toBe(true);
    expect(second.aborted).toBe(true);
    expect(policy.seenPostCount).toBe(2);
  });

  it("rende fatale la POST seen esatta se il target recording e' dashboard", async () => {
    const policy = createGetOnlyRequestPolicy();
    const seen = interceptedRoute({
      method: "POST",
      url: SYNTHETIC_POSITION_SEEN_URL,
      body: SYNTHETIC_POSITION_SEEN_BODY,
    });
    const failedTake = expect(policy.violation).rejects.toThrow(
      "policy GET-only violata: richiesta POST bloccata",
    );

    await policy.handle(seen.route);
    await failedTake;

    expect(seen.aborted).toBe(true);
    expect(policy.seenPostCount).toBe(0);
  });

  it.each([
    [
      "position_id diverso",
      "POST",
      SYNTHETIC_POSITION_SEEN_URL,
      '{"position_id":"9002"}',
    ],
    [
      "corpo JSON diverso",
      "POST",
      SYNTHETIC_POSITION_SEEN_URL,
      '{"position_id":"9001","counter":1}',
    ],
    [
      "route diversa",
      "POST",
      "http://localhost:3008/api/positions/other",
      SYNTHETIC_POSITION_SEEN_BODY,
    ],
    ["PUT", "PUT", SYNTHETIC_POSITION_SEEN_URL, SYNTHETIC_POSITION_SEEN_BODY],
    [
      "DELETE",
      "DELETE",
      SYNTHETIC_POSITION_SEEN_URL,
      SYNTHETIC_POSITION_SEEN_BODY,
    ],
  ])(
    "rende fatale una richiesta %s",
    async (_description, method, url, body) => {
      const policy = createGetOnlyRequestPolicy(
        console.error,
        SYNTHETIC_POSITION_RECORDING_ROUTE,
      );
      const request = interceptedRoute({ method, url, body });
      const failedTake = expect(policy.violation).rejects.toThrow(
        `policy GET-only violata: richiesta ${method} bloccata`,
      );

      await policy.handle(request.route);
      await failedTake;

      expect(request.aborted).toBe(true);
      expect(request.continued).toBe(false);
      expect(policy.seenPostCount).toBe(0);
    },
  );
});
