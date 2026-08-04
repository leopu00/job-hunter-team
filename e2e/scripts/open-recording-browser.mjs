#!/usr/bin/env node
/**
 * Apre il frame iniziale delle riprese web in Chromium, senza trasformare lo
 * storage state Playwright in un profilo del browser nativo.
 *
 * Uso dalla root del repository:
 *   JHT_RECORDING_PROFILE=software BASE_URL=http://localhost:3008 npm --prefix e2e run recording-browser
 *
 * Non esegue login, reset, POST o DELETE. Il contesto e' effimero: applica il
 * solo storage state privato al Chromium lanciato da Playwright e lo elimina
 * alla chiusura della finestra.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";

const ALIASES = new Set(["software", "marketing", "finance", "design"]);
const LOCAL_RECORDING_ORIGIN = "http://localhost:3008";

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

function localRecordingDashboard() {
  const baseURL = process.env.BASE_URL || LOCAL_RECORDING_ORIGIN;
  let url;
  try {
    url = new URL(baseURL);
  } catch {
    throw new Error("invalid base URL");
  }
  if (url.origin !== LOCAL_RECORDING_ORIGIN) {
    throw new Error("unexpected recording origin");
  }
  return new URL("/dashboard", url).toString();
}

async function main() {
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

  let dashboard;
  try {
    dashboard = localRecordingDashboard();
  } catch {
    fail("BASE_URL deve essere esattamente http://localhost:3008");
    return;
  }

  let browser;
  try {
    browser = await chromium.launch({
      headless: false,
      args: ["--kiosk"],
    });
    const context = await browser.newContext({
      storageState,
      viewport: null,
    });

    // Il context non riusa un profilo nativo. La rimozione e' locale alla sua
    // cookie jar e precede ogni navigazione: nessuna chiamata HTTP di pulizia.
    await context.clearCookies({ name: "jht_demo_persona" });
    await context.addInitScript(() => {
      localStorage.setItem("jht-theme", "light");
      localStorage.setItem("jht-tour-done", "1");
    });

    const page = await context.newPage();
    const response = await page.goto(dashboard, {
      waitUntil: "domcontentloaded",
    });
    if (response?.status() !== 200) {
      throw new Error("dashboard unavailable");
    }
    await page.waitForFunction(
      () => document.documentElement.getAttribute("data-theme") === "light",
    );

    console.log(
      "✓ Recording browser pronto: Chromium kiosk su /dashboard in tema light. Ctrl+C per chiudere.",
    );

    await new Promise((resolve) => {
      const done = () => resolve();
      process.once("SIGINT", done);
      process.once("SIGTERM", done);
      browser.once("disconnected", done);
    });
  } finally {
    if (browser?.isConnected()) await browser.close();
  }
}

main().catch(() =>
  fail("launcher non avviato: controlla auth-state e istanza locale"),
);
