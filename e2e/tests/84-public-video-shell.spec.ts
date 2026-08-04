import { expect, test } from "@playwright/test";

const MEDIA_REQUEST = /\.(?:m3u8|mp4|vtt|webm)(?:[?#]|$)/i;

test.describe("shell pubblico tutorial e trailer", () => {
  test("/tutorials espone entrambe le ancore senza scaricare media", async ({
    page,
  }) => {
    const mediaRequests: string[] = [];
    page.on("request", (request) => {
      if (MEDIA_REQUEST.test(request.url())) mediaRequests.push(request.url());
    });

    const response = await page.goto("/tutorials", {
      waitUntil: "domcontentloaded",
    });
    expect(response?.status(), "/tutorials non risponde").toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("#game")).toBeVisible();
    await expect(page.locator("#web")).toBeVisible();
    expect(await page.locator("[data-video-pending]").count()).toBe(2);
    expect(await page.locator("video").count()).toBe(0);
    expect(mediaRequests, "media richiesti prima di un click").toEqual([]);

    await expect(
      page.locator('nav a[href="/tutorials"]').first(),
    ).toBeVisible();
    await expect(page.locator('footer a[href="/tutorials"]')).toBeVisible();
  });

  test("/trailer resta una pagina dedicata senza player o media remoti", async ({
    page,
  }) => {
    const mediaRequests: string[] = [];
    page.on("request", (request) => {
      if (MEDIA_REQUEST.test(request.url())) mediaRequests.push(request.url());
    });

    const response = await page.goto("/trailer", {
      waitUntil: "domcontentloaded",
    });
    expect(response?.status(), "/trailer non risponde").toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await page.locator("[data-video-pending=trailer]").count()).toBe(1);
    expect(await page.locator("video").count()).toBe(0);
    expect(mediaRequests, "media trailer richiesti prima di un click").toEqual(
      [],
    );
  });

  test("le card restano responsive sul viewport stretto", async (
    { browser },
    testInfo,
  ) => {
    const context = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      viewport: { width: 375, height: 812 },
    });
    const page = await context.newPage();
    await page.goto("/tutorials", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#game")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      "overflow orizzontale su mobile",
    ).toBe(true);
    await context.close();
  });
});
