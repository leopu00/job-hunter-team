import { chromium, expect, test, type Page } from "@playwright/test";

async function holdCapabilityProbe(page: Page, webgl: "off" | "capable") {
  await page.addInitScript((glMode) => {
    const browserWindow = window as Window & {
      __runGlobeCapabilityProbe?: () => void;
    };
    let nextIdleId = 1;
    const idleCallbacks = new Map<number, () => void>();
    window.requestIdleCallback = ((callback: () => void) => {
      const id = nextIdleId++;
      idleCallbacks.set(id, callback);
      return id;
    }) as typeof window.requestIdleCallback;
    window.cancelIdleCallback = ((id: number) => {
      idleCallbacks.delete(id);
    }) as typeof window.cancelIdleCallback;
    browserWindow.__runGlobeCapabilityProbe = () => {
      const callbacks = [...idleCallbacks.values()];
      idleCallbacks.clear();
      for (const callback of callbacks) callback();
    };

    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    let probePending = glMode === "capable";
    HTMLCanvasElement.prototype.getContext = function (contextId, ...args) {
      if (contextId === "webgl" || contextId === "webgl2") {
        if (glMode === "off") return null;
        if (probePending) {
          probePending = false;
          return {
            getExtension: (name: string) =>
              name === "WEBGL_lose_context" ? { loseContext: () => {} } : null,
            getParameter: () => "Apple M3",
          } as unknown as WebGLRenderingContext;
        }
      }
      return (originalGetContext as (...values: unknown[]) => unknown).apply(
        this,
        [contextId, ...args],
      ) as RenderingContext | null;
    };
    Object.defineProperty(navigator, "hardwareConcurrency", {
      configurable: true,
      value: 8,
    });
    Object.defineProperty(navigator, "deviceMemory", {
      configurable: true,
      value: 8,
    });
  }, webgl);
}

async function releaseCapabilityProbe(page: Page) {
  await page.evaluate(async () => {
    const browserWindow = window as Window & {
      __runGlobeCapabilityProbe?: () => void;
    };
    // `domcontentloaded` può precedere di pochi frame l'effect React che
    // registra il probe. Svuota la coda finché lo stato lascia `pending`,
    // senza trasformare una race del test in cinque secondi di attesa.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      browserWindow.__runGlobeCapabilityProbe?.();
      if (
        document
          .querySelector("[data-globe-mode]")
          ?.getAttribute("data-globe-mode") !== "pending"
      ) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  });
}

test("cache pulita passa dallo slot vuoto al solo globo 3D con fade morbido", async ({}, testInfo) => {
  const browser = await chromium.launch({
    headless: true,
    args: ["--enable-unsafe-swiftshader"],
  });
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  await holdCapabilityProbe(page, "capable");
  await page.route(
    /https:\/\/basemaps\.cartocdn\.com\/gl\/.*\/style\.json/,
    async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          version: 8,
          sources: {},
          layers: [
            {
              id: "background",
              type: "background",
              paint: { "background-color": "#0c0b10" },
            },
          ],
        }),
      });
    },
  );

  try {
    const response = await page.goto("/", { waitUntil: "domcontentloaded" });
    expect(response?.status(), "home non risponde").toBe(200);
    const stage = page.locator("[data-landing-globe] [data-globe-mode]");
    await expect(stage).toHaveAttribute("data-globe-mode", "pending");
    await expect(stage.locator(".jht-globe-still")).toHaveCount(0);
    const reservedHeight = await stage.evaluate(
      (element) => element.getBoundingClientRect().height,
    );

    await releaseCapabilityProbe(page);
    await expect(stage).toHaveAttribute("data-globe-mode", "live", {
      timeout: 2500,
    });
    const live = stage.locator('[role="group"]');
    await expect(live).toHaveCSS("visibility", "visible");
    await expect(live).toHaveCSS("opacity", "1");
    await expect(stage.locator(".jht-globe-still")).toHaveCount(0);
    expect(
      Math.abs(
        (await stage.evaluate(
          (element) => element.getBoundingClientRect().height,
        )) - reservedHeight,
      ),
      "il primo frame 3D cambia l'altezza dello slot",
    ).toBeLessThanOrEqual(1);
    expect(
      await page.evaluate(() =>
        performance
          .getEntriesByType("resource")
          .some((entry) => entry.name.includes("landing-globe-still.jpg")),
      ),
      "il percorso 3D veloce ha scaricato il fallback",
    ).toBe(false);
  } finally {
    await context.close();
    await browser.close();
  }
});

test("WebGL assente sceglie la fissa senza staffetta e senza layout shift", async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    viewport: { width: 375, height: 812 },
  });
  const page = await context.newPage();
  await holdCapabilityProbe(page, "off");

  try {
    const response = await page.goto("/", { waitUntil: "domcontentloaded" });
    expect(response?.status(), "home non risponde").toBe(200);

    const globe = page.locator("[data-landing-globe]");
    const stage = globe.locator("[data-globe-mode]");
    await expect(stage).toHaveAttribute("data-globe-mode", "pending");
    await expect(globe.locator(".jht-globe-still")).toHaveCount(0);
    await expect(globe.locator("[role=group]")).toHaveCount(0);
    const reservedRect = await stage.evaluate((element) =>
      element.getBoundingClientRect().toJSON(),
    );
    expect(reservedRect.height, "slot del globo non riservato").toBeGreaterThan(
      300,
    );

    await releaseCapabilityProbe(page);
    await expect(stage).toHaveAttribute("data-globe-mode", "static");
    const credit = globe.locator(".jht-globe-static-credit");

    await expect(globe.locator(".jht-globe-badge")).toHaveCount(0);
    await expect(globe.locator(".jht-globe-still")).toBeVisible();
    await expect(credit).toBeVisible();

    const [creditFont, globeRect, stageRect, creditRect, hasOverflow] =
      await Promise.all([
        credit.evaluate((element) =>
          Number.parseFloat(window.getComputedStyle(element).fontSize),
        ),
        globe.evaluate((element) => element.getBoundingClientRect().toJSON()),
        stage.evaluate((element) => element.getBoundingClientRect().toJSON()),
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
    expect(
      Math.abs(stageRect.height - reservedRect.height),
      "il fallback cambia l'altezza dello slot",
    ).toBeLessThanOrEqual(1);

    await page.waitForTimeout(900);
    await expect(stage).toHaveAttribute("data-globe-mode", "static");
    await expect(globe.locator("[role=group]")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("rete lenta lascia vuoto il primo secondo, poi sceglie la fissa e ci resta", async ({}, testInfo) => {
  const browser = await chromium.launch({
    headless: true,
    args: ["--enable-unsafe-swiftshader"],
  });
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  await holdCapabilityProbe(page, "capable");
  await page.route("https://basemaps.cartocdn.com/**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 4000));
    await route.continue().catch(() => undefined);
  });

  try {
    const response = await page.goto("/", { waitUntil: "domcontentloaded" });
    expect(response?.status(), "home non risponde").toBe(200);
    const stage = page.locator("[data-landing-globe] [data-globe-mode]");
    const reservedHeight = await stage.evaluate(
      (element) => element.getBoundingClientRect().height,
    );
    await expect(stage).toHaveAttribute("data-globe-mode", "pending");
    await releaseCapabilityProbe(page);
    await expect(stage).toHaveAttribute("data-globe-mode", "warming");

    await page.waitForTimeout(1000);
    await expect(stage).toHaveAttribute("data-globe-mode", "warming");
    await expect(stage.locator(".jht-globe-still")).toHaveCount(0);
    await expect(stage.locator('[role="group"]')).toHaveCSS(
      "visibility",
      "hidden",
    );

    await expect(stage).toHaveAttribute("data-globe-mode", "static", {
      timeout: 2500,
    });
    await expect(stage.locator(".jht-globe-still")).toBeVisible();
    expect(
      Math.abs(
        (await stage.evaluate(
          (element) => element.getBoundingClientRect().height,
        )) - reservedHeight,
      ),
      "la deadline statica cambia l'altezza dello slot",
    ).toBeLessThanOrEqual(1);

    // Anche quando la risposta CARTO tardiva si sblocca, la decisione è finale.
    await page.waitForTimeout(2200);
    await expect(stage).toHaveAttribute("data-globe-mode", "static");
    await expect(stage.locator('[role="group"]')).toHaveCount(0);
  } finally {
    await context.close();
    await browser.close();
  }
});
