#!/usr/bin/env node
/**
 * Apre il frame iniziale delle riprese web in Chromium, senza trasformare lo
 * storage state Playwright in un profilo del browser nativo.
 *
 * Uso dalla root del repository:
 *   JHT_RECORDING_PROFILE=software JHT_RECORDING_PATH=/messages npm --prefix e2e run recording-browser
 *
 * Non esegue login, reset, POST o DELETE. Il contesto e' effimero: applica il
 * solo storage state privato al Chromium lanciato da Playwright e lo elimina
 * alla chiusura della finestra.
 */
import fs from "node:fs";
import { chromium } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import {
  ALLOWED_RECORDING_ROUTES,
  createGetOnlyRequestPolicy,
  recordingTarget,
  SYNTHETIC_POSITION_RECORDING_ROUTE,
} from "./recording-browser-policy.mjs";
import {
  assertPortraitGeometry,
  assertPortraitMobileDocument,
  recordingFormatFromEnvironment,
  PORTRAIT_RECORDING_MOBILE_EMULATION,
} from "./recording-browser-format.mjs";

const ALIASES = new Set(["software", "marketing", "finance", "design"]);

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exitCode = 1;
}

function recordingStatePath(alias) {
  const dataHome =
    process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(
    dataHome,
    "jht",
    "recording-profiles",
    alias,
    "auth-state.json",
  );
}

async function main() {
  let format;
  try {
    format = recordingFormatFromEnvironment();
  } catch (error) {
    fail(error.message);
    return;
  }

  const alias = process.env.JHT_RECORDING_PROFILE;
  if (!alias || !ALIASES.has(alias)) {
    fail(
      "imposta JHT_RECORDING_PROFILE a uno dei profili recording autorizzati",
    );
    return;
  }

  const storageState =
    process.env.JHT_RECORDING_AUTH_STATE || recordingStatePath(alias);
  if (!fs.existsSync(storageState)) {
    fail("auth-state privato del profilo recording assente");
    return;
  }

  let target;
  try {
    target = recordingTarget();
  } catch {
    fail(
      `JHT_RECORDING_PATH deve essere una delle route esatte: ${[...ALLOWED_RECORDING_ROUTES].join(", ")}`,
    );
    return;
  }

  let browser;
  try {
    browser = await chromium.launch(
      format === "portrait"
        ? {
            headless: false,
            args: [
              "--kiosk",
              "--ozone-platform=wayland",
              "--force-device-scale-factor=2",
            ],
          }
        : {
            headless: false,
            args: ["--kiosk"],
          },
    );
    const context = await browser.newContext(
      format === "portrait"
        ? {
            storageState,
            viewport: { width: 540, height: 960 },
            deviceScaleFactor: 2,
            ...PORTRAIT_RECORDING_MOBILE_EMULATION,
          }
        : {
            storageState,
            viewport: null,
          },
    );
    const getOnly = createGetOnlyRequestPolicy(
      console.error,
      new URL(target).pathname,
    );
    await context.route("**/*", getOnly.handle);

    // Il context non riusa un profilo nativo. La rimozione e' locale alla sua
    // cookie jar e precede ogni navigazione: nessuna chiamata HTTP di pulizia.
    await context.clearCookies({ name: "jht_demo_persona" });
    await context.addInitScript(() => {
      localStorage.setItem("jht-theme", "light");
      localStorage.setItem("jht-tour-done", "1");
    });

    const page = await context.newPage();
    if (format === "portrait") await assertPortraitGeometry(page);
    const response = await page.goto(target, {
      waitUntil: "domcontentloaded",
    });
    if (response?.status() !== 200) {
      throw new Error("dashboard unavailable");
    }
    if (page.url() !== target) {
      throw new Error("recording route redirected");
    }
    if (format === "portrait") {
      await assertPortraitGeometry(page);
      await assertPortraitMobileDocument(page);
    }
    await page.waitForFunction(
      () => document.documentElement.getAttribute("data-theme") === "light",
    );
    if (new URL(target).pathname === SYNTHETIC_POSITION_RECORDING_ROUTE) {
      await Promise.race([getOnly.allowedSeenPost, getOnly.violation]);
      if (getOnly.seenPostCount !== 1) {
        throw new Error(
          "marker seen sintetico non osservato esattamente una volta",
        );
      }
    }

    console.log(
      `✓ Recording browser pronto: Chromium kiosk su ${new URL(target).pathname} in tema light. Ctrl+C per chiudere.`,
    );

    await Promise.race([
      new Promise((resolve) => {
        const done = () => resolve();
        process.once("SIGINT", done);
        process.once("SIGTERM", done);
        browser.once("disconnected", done);
      }),
      getOnly.violation,
    ]);
  } finally {
    if (browser?.isConnected()) await browser.close();
  }
}

main().catch(() =>
  fail("launcher non avviato: controlla auth-state e istanza locale"),
);
