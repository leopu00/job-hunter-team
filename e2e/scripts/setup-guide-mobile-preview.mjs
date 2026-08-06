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
    });
    const page = await context.newPage();
    await page.goto(`${BASE}/setup-guide?os=${os}`, {
      waitUntil: "domcontentloaded",
    });
    // Mai `networkidle`: il sito ha risorse che non si acquietano mai.
    await page.waitForSelector("h1");
    await page.waitForTimeout(1200);

    const full = path.join(OUT, `${os}-00-full-page.png`);
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
        `${os}-${String(index + 1).padStart(2, "0")}-${id.replace("chapter-", "")}.png`,
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
