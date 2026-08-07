import { expect, test } from "@playwright/test";

const MEDIA_REQUEST = /\.(?:m3u8|mp4|vtt|webm)(?:[?#]|$)/i;

test.describe("shell pubblico tutorial e trailer", () => {
  test("la home monta il player differito dopo il globo senza link legacy", async ({
    page,
  }) => {
    const mediaRequests: string[] = [];
    page.on("request", (request) => {
      if (MEDIA_REQUEST.test(request.url())) mediaRequests.push(request.url());
    });

    const response = await page.goto("/", { waitUntil: "domcontentloaded" });
    expect(response?.status(), "home non risponde").toBe(200);

    const trailer = page.locator("[data-trailer-inline]");
    await expect(trailer).toBeVisible();
    const launch = trailer.locator("[data-video-launch=trailer]");
    await expect(launch).toBeVisible();
    await expect(trailer.locator("h2")).toHaveCount(0);
    await expect(page.getByText("Trailer", { exact: true })).toHaveCount(0);
    await expect(trailer.locator("[data-video-pending]")).toHaveCount(0);
    expect(await page.locator('a[href="/trailer"]').count()).toBe(0);
    expect(await trailer.locator("video").count()).toBe(0);
    await expect(trailer.locator("[data-music-credit]")).toHaveCount(0);
    await expect(page.locator('footer a[href="/credits"]')).toBeVisible();
    expect(mediaRequests, "home ha richiesto media prima di un click").toEqual(
      [],
    );

    expect(
      await page.evaluate(() => {
        const globe = document.querySelector("[data-landing-globe]");
        const trailer = document.querySelector("[data-trailer-inline]");
        return Boolean(
          globe &&
          trailer &&
          globe.compareDocumentPosition(trailer) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        );
      }),
      "player trailer non montato sotto il globo",
    ).toBe(true);

    await launch.click();
    const video = trailer.locator("video");
    await expect(video).toBeVisible();
    await expect(video).toHaveAttribute("controls", "");
    await expect
      .poll(() => mediaRequests.some((url) => url.endsWith(".mp4")))
      .toBe(true);
  });

  test("/tutorials reindirizza alla guida e sparisce dalla navigazione", async ({
    page,
  }) => {
    const mediaRequests: string[] = [];
    page.on("request", (request) => {
      if (MEDIA_REQUEST.test(request.url())) mediaRequests.push(request.url());
    });

    const response = await page.goto("/tutorials", {
      waitUntil: "domcontentloaded",
    });
    expect(
      response?.status(),
      "redirect /tutorials non arriva alla guida",
    ).toBe(200);
    expect(response?.request().redirectedFrom()?.url()).toMatch(/\/tutorials$/);
    expect(new URL(page.url()).pathname).toBe("/setup-guide");
    await expect(page.locator("[data-setup-guide]")).toBeVisible();
    expect(await page.locator("#game, #web").count()).toBe(0);
    expect(await page.locator('a[href="/tutorials"]').count()).toBe(0);
    await expect(
      page.locator('nav a[href="/setup-guide"]').first(),
    ).toBeVisible();
    await expect(page.locator('footer a[href="/setup-guide"]')).toBeVisible();
    expect(mediaRequests, "media richiesti durante il redirect").toEqual([]);

    const sitemap = await page.request.get("/sitemap.xml");
    expect(sitemap.status()).toBe(200);
    const sitemapBody = await sitemap.text();
    expect(sitemapBody).not.toContain("/tutorials");
    expect(sitemapBody).toContain("/setup-guide");
  });

  test("/trailer reindirizza al player sulla home e non resta nella sitemap", async ({
    page,
  }) => {
    const mediaRequests: string[] = [];
    page.on("request", (request) => {
      if (MEDIA_REQUEST.test(request.url())) mediaRequests.push(request.url());
    });

    const response = await page.goto("/trailer", {
      waitUntil: "domcontentloaded",
    });
    expect(response?.status(), "redirect /trailer non arriva alla home").toBe(
      200,
    );
    expect(response?.request().redirectedFrom()?.url()).toMatch(/\/trailer$/);
    expect(new URL(page.url()).pathname).toBe("/");
    expect(new URL(page.url()).hash).toBe("#trailer");
    expect(await page.locator("[data-video-launch=trailer]").count()).toBe(1);
    expect(await page.locator("[data-video-pending]").count()).toBe(0);
    await expect(page.locator("#trailer [data-music-credit]")).toHaveCount(0);
    expect(await page.locator("video").count()).toBe(0);
    expect(mediaRequests, "media trailer richiesti prima di un click").toEqual(
      [],
    );

    const sitemap = await page.request.get("/sitemap.xml");
    expect(sitemap.status()).toBe(200);
    expect(await sitemap.text()).not.toContain("/trailer");
  });

  test("le card restano responsive sul viewport stretto", async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      viewport: { width: 375, height: 812 },
    });
    const page = await context.newPage();
    await page.goto("/setup-guide", { waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-setup-guide]")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      "overflow orizzontale su mobile",
    ).toBe(true);
    await context.close();
  });
});
