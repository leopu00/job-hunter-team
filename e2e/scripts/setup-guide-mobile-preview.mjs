// Preview per telefono della guida di setup: uno screenshot per capitolo,
// più la pagina intera, a larghezza 390 px (iPhone 14/15).
//
// Uso:
//   node e2e/scripts/setup-guide-mobile-preview.mjs [baseUrl] [outDir]
//
// Default: http://localhost:3002 e docs/previews/setup-guide-mobile/.
// Gira sui tre sistemi operativi selezionabili, perché la guida cambia le
// fasi in base all'OS: una preview del solo macOS non dimostra nulla su
// Windows.

import { chromium, devices } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3002";
const OUT = process.argv[3] ?? "docs/previews/setup-guide-mobile";
const OS_LIST = ["macos", "windows", "linux"];
const PHONE = { width: 390, height: 844 };

// Lingua e tema si passano da fuori. Il tedesco serve come prova del nove
// del layout: è la lingua più lunga del catalogo, e se una riga sfonda lo
// fa lì per prima. Il tema scuro è quello di default del sito.
//   LANG=de SCHEME=dark node e2e/scripts/setup-guide-mobile-preview.mjs
const LANG = process.env.LANG_CODE ?? "en";
const SCHEME = process.env.SCHEME === "dark" ? "dark" : "light";
const SUFFIX = LANG === "en" && SCHEME === "light" ? "" : `-${LANG}-${SCHEME}`;

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const written = [];

  for (const os of OS_LIST) {
    const context = await browser.newContext({
      ...devices["iPhone 14"],
      viewport: PHONE,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      colorScheme: SCHEME,
    });
    // La lingua del sito vive in localStorage: va scritta prima del primo
    // render, altrimenti la pagina monta in inglese e si vede il cambio.
    // Insieme si segna il consenso ai cookie: il suo banner è fisso in
    // basso e finirebbe in mezzo a ogni inquadratura di capitolo,
    // coprendo proprio ciò che la preview deve mostrare.
    await context.addInitScript((lang) => {
      window.localStorage.setItem("jht-lang", lang);
      window.localStorage.setItem("jht:cookie-consent", "necessary");
    }, LANG);
    const page = await context.newPage();
    await page.goto(`${BASE}/setup-guide?os=${os}`, {
      waitUntil: "domcontentloaded",
    });
    // Mai `networkidle`: il sito ha risorse che non si acquietano mai.
    await page.waitForSelector("h1");
    await page.waitForTimeout(1200);

    const full = path.join(OUT, `${os}${SUFFIX}-00-full-page.png`);
    await page.screenshot({ path: full, fullPage: true });
    written.push(full);

    const chapters = await page.$$eval("section[id^='chapter-']", (nodes) =>
      nodes.map((n) => n.id),
    );
    for (const [index, id] of chapters.entries()) {
      const section = page.locator(`#${id}`);
      await section.scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      const file = path.join(
        OUT,
        `${os}${SUFFIX}-${String(index + 1).padStart(2, "0")}-${id.replace("chapter-", "")}.png`,
      );
      await section.screenshot({ path: file });
      written.push(file);
    }

    await context.close();
  }

  await browser.close();
  console.log(`${written.length} screenshot in ${OUT}`);
  for (const file of written) console.log(`  ${file}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
