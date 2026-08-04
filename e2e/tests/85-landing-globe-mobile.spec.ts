import { expect, test } from "@playwright/test";

test("il globo pubblico mantiene l'attribuzione leggibile su mobile senza badge dimostrativo", async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    viewport: { width: 375, height: 812 },
  });
  const page = await context.newPage();

  try {
    const response = await page.goto("/", { waitUntil: "domcontentloaded" });
    expect(response?.status(), "home non risponde").toBe(200);

    const globe = page.locator("[data-landing-globe]");
    const credit = globe.locator(".jht-globe-static-credit");

    await expect(globe.locator(".jht-globe-badge")).toHaveCount(0);
    await expect(credit).toBeVisible();

    const [creditFont, globeRect, creditRect, hasOverflow] = await Promise.all([
      credit.evaluate((element) =>
        Number.parseFloat(window.getComputedStyle(element).fontSize),
      ),
      globe.evaluate((element) => element.getBoundingClientRect().toJSON()),
      credit.evaluate((element) => element.getBoundingClientRect().toJSON()),
      page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      ),
    ]);

    expect(
      creditFont,
      "attribuzione sotto 10px su mobile",
    ).toBeGreaterThanOrEqual(10);
    expect(
      creditRect.bottom,
      "attribuzione fuori dal globo",
    ).toBeLessThanOrEqual(globeRect.bottom);
    expect(hasOverflow, "overflow orizzontale su mobile").toBe(false);
  } finally {
    await context.close();
  }
});
