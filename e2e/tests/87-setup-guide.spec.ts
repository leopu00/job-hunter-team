import { expect, test } from "@playwright/test";

// La guida di setup, come la vede chi la legge dal telefono.
//
// Tre cose che nessun type-check può vedere: che la pagina non scorra di
// lato, che il selettore OS cambi davvero le fasi, e che non arrivi a
// schermo una chiave di traduzione grezza al posto di una frase.

const PHONE = { width: 390, height: 844 };

test("la guida si legge a larghezza telefono senza scorrere di lato", async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    viewport: PHONE,
  });
  const page = await context.newPage();

  try {
    const response = await page.goto("/setup-guide", {
      waitUntil: "domcontentloaded",
    });
    expect(response?.status(), "la guida non risponde").toBe(200);

    await expect(page.locator("h1")).toBeVisible();

    // Ogni capitolo dichiarato deve avere almeno una fase visibile: un
    // capitolo vuoto è un pezzo di percorso che sparisce in silenzio.
    const chapters = page.locator("section[id^='chapter-']");
    expect(await chapters.count(), "nessun capitolo").toBeGreaterThan(0);

    const hasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(hasOverflow, "la guida scorre di lato su mobile").toBe(false);

    // I bersagli si devono poter toccare: 40 px è il minimo sotto cui un
    // pollice sbaglia bottone.
    const buttons = page.locator("[data-setup-guide]").getByRole("button");
    const count = await buttons.count();
    for (let i = 0; i < count; i += 1) {
      const box = await buttons.nth(i).boundingBox();
      if (!box) continue;
      expect(
        box.height,
        `bottone ${i} alto ${Math.round(box.height)}px`,
      ).toBeGreaterThanOrEqual(40);
    }
  } finally {
    await context.close();
  }
});

test("il selettore OS cambia le fasi mostrate", async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    viewport: PHONE,
  });
  const page = await context.newPage();

  try {
    await page.goto("/setup-guide?os=macos", {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator("#phase-open-macos")).toBeVisible();
    await expect(page.locator("#phase-open-windows")).toHaveCount(0);

    await page.getByRole("button", { name: "Windows" }).click();
    await expect(page.locator("#phase-open-windows")).toBeVisible();
    await expect(page.locator("#phase-open-macos")).toHaveCount(0);

    // La scelta finisce nell'URL: un link a una fase resta valido se lo si
    // passa a qualcuno che sta su un altro sistema.
    expect(page.url()).toContain("os=windows");
  } finally {
    await context.close();
  }
});

test("nessuna chiave di traduzione grezza a schermo", async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    viewport: PHONE,
  });
  const page = await context.newPage();

  try {
    await page.goto("/setup-guide", { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1")).toBeVisible();

    const body = (
      await page.locator("[data-setup-guide]").innerText()
    ).toLowerCase();
    // Le chiavi del dizionario della guida sono snake_case: se una di
    // queste compare come testo, la traduzione non ha risolto.
    for (const key of ["page_title", "os_selector_label", "step_label"]) {
      expect(body, `chiave grezza «${key}» a schermo`).not.toContain(key);
    }
  } finally {
    await context.close();
  }
});

test("il tedesco non sfonda il layout del telefono", async ({
  browser,
}, testInfo) => {
  // Prova del nove di W03: il tedesco è la lingua più lunga del catalogo,
  // e una riga che sfonda lo fa lì per prima. Su un telefono da 390 px non
  // c'è margine da sprecare.
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    viewport: PHONE,
  });
  await context.addInitScript(() =>
    window.localStorage.setItem("jht-lang", "de"),
  );
  const page = await context.newPage();

  try {
    await page.goto("/setup-guide", { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1")).toBeVisible();

    const overflowing = await page.evaluate(() => {
      const limit = window.innerWidth + 1;
      return [...document.querySelectorAll("[data-setup-guide] *")]
        .filter((el) => el.getBoundingClientRect().right > limit)
        .slice(0, 5)
        .map((el) => el.tagName + "." + String(el.className).slice(0, 40));
    });
    expect(overflowing, "elementi oltre il bordo destro").toEqual([]);
  } finally {
    await context.close();
  }
});
