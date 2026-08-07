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
    await expect(trailer.locator("[data-video-pending=trailer]")).toBeVisible();
    expect(await page.locator('a[href="/trailer"]').count()).toBe(0);
    expect(await trailer.locator("video").count()).toBe(0);
    const musicCredit = trailer.locator('section[aria-label="Music credit"]');
    await expect(musicCredit).toBeVisible();
    expect(await musicCredit.locator(":scope > p").allTextContents()).toEqual([
      "Covert Affair Kevin MacLeod (incompetech.com)",
      "Licensed under Creative Commons: By Attribution 4.0",
      "https://creativecommons.org/licenses/by/4.0/",
      "Edited for timing and mixed with a CC0 cymbal-roll intro.",
    ]);
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
  });

  test("/tutorials mette il testo prima del video e non scarica media", async ({
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
    await expect(
      page.locator("#game").getByText("Plan the setup"),
    ).toBeVisible();
    await expect(
      page.locator("#game").getByText("Set up the team"),
    ).toBeVisible();
    await expect(
      page.locator("#game").getByText("Download the native desktop app"),
    ).toBeVisible();
    await expect(
      page.locator("#game").getByText("Meet the office"),
    ).toBeVisible();
    const tutorialScreenshots = page.locator(
      "#game [data-tutorial-step-image]",
    );
    await expect(tutorialScreenshots).toHaveCount(2);
    await expect(
      tutorialScreenshots
        .first()
        .getByRole("img", { name: "Overview of the native office" }),
    ).toHaveAttribute("src", /office-overview\.png/);
    await expect(
      tutorialScreenshots
        .nth(1)
        .getByRole("img", { name: "A department work area" }),
    ).toHaveAttribute("src", /departments\.png/);
    await expect(tutorialScreenshots.first()).toContainText(
      "The native office is the workspace",
    );
    await expect(
      page.locator("#web").getByText("Start from the dashboard"),
    ).toBeVisible();
    await expect(
      page.locator("#game").getByText("Prefer to watch instead?"),
    ).toBeVisible();
    expect(
      await page.locator("#game").evaluate((section) => {
        const text = section.querySelector("ol");
        const video = section.querySelector("[data-video-pending]");
        return Boolean(
          text &&
          video &&
          text.compareDocumentPosition(video) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        );
      }),
      "video montato prima dei passi testuali",
    ).toBe(true);
    expect(await page.locator("[data-video-pending]").count()).toBe(2);
    expect(await page.locator("video").count()).toBe(0);
    expect(mediaRequests, "media richiesti prima di un click").toEqual([]);

    await expect(
      page.locator('nav a[href="/tutorials"]').first(),
    ).toBeVisible();
    await expect(page.locator('footer a[href="/tutorials"]')).toBeVisible();
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
    expect(await page.locator("[data-video-pending=trailer]").count()).toBe(1);
    const musicCredit = page.locator(
      '#trailer section[aria-label="Music credit"]',
    );
    await expect(musicCredit).toBeVisible();
    await expect(
      musicCredit.locator(
        'a[href="https://creativecommons.org/licenses/by/4.0/"]',
      ),
    ).toBeVisible();
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
