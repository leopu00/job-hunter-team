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

    // Il confronto NON può essere con `window.innerWidth`: il body ha
    // `zoom: 1.15` (globals.css) e, quando un elemento sfonda, il viewport
    // stesso si allarga e `innerWidth` cresce insieme a lui — il gate
    // passava mentre la pagina era larga 417 CSS invece di 339. Il
    // riferimento giusto è la larghezza attesa, viewport diviso lo zoom.
    // Trovato da HQ-FULLSTACK-1 misurando i pixel della preview tedesca.
    const width = await page.evaluate(() => {
      const zoom =
        Number.parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue("--zoom"),
        ) || 1;
      return {
        actual: document.body.scrollWidth,
        expected: window.visualViewport
          ? window.visualViewport.width / zoom
          : 390 / zoom,
      };
    });
    expect(
      width.actual,
      `la guida è larga ${width.actual} CSS px invece di ${Math.round(width.expected)}`,
    ).toBeLessThanOrEqual(Math.ceil(width.expected) + 1);

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
    // La pagina dichiara da sé quando il selettore è vivo: prima
    // dell'idratazione un click si perde e il test fallirebbe per un
    // motivo che non c'entra con la guida.
    //
    // Il timeout è largo di proposito: contro `next dev` la prima visita a
    // una route la compila al volo, e su una macchina carica ci vuole più
    // dei 5 secondi di default. Aspettare la condizione vera con margine è
    // meglio di un rosso che compare a caso e che poi nessuno crede.
    await expect(page.locator("[data-guide-ready='true']")).toBeAttached({
      timeout: 30_000,
    });
    await expect(page.locator("#phase-install-macos")).toBeVisible();
    await expect(page.locator("#phase-install-windows")).toHaveCount(0);

    // Il click va aspettato sullo stato del bottone, non solo sulle fasi:
    // se arriva prima che React abbia idratato, il selettore non ha ancora
    // il suo handler e il test fallisce per un motivo che non c'entra.
    const windows = page.getByRole("button", { name: "Windows" });
    await windows.click();
    await expect(windows).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#phase-install-windows")).toBeVisible();
    await expect(page.locator("#phase-install-macos")).toHaveCount(0);

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

    // L'inglese è il default della guida. Queste frasi italiane sono
    // traduzioni reali delle fasi più visibili: se compaiono qui, il frame
    // della demo ha mescolato due cataloghi anche se nessuna chiave è grezza.
    expect(body).toContain("check the requirements");
    for (const italian of [
      "controlla i requisiti",
      "accedi con google",
      "controlla gli accessi",
      "screenshot in attesa",
    ]) {
      expect(
        body,
        `residuo italiano «${italian}» nel default EN`,
      ).not.toContain(italian);
    }
  } finally {
    await context.close();
  }
});

test("il titolo della scheda segue la lingua scelta, non il server", async ({
  browser,
}, testInfo) => {
  // La pagina Download ha oggi questo difetto: il titolo esce dal locale
  // dedotto lato server, che senza cookie ricade su italiano, mentre il
  // contenuto parte in inglese — tab e pagina in due lingue diverse. Qui
  // il titolo deve seguire il selettore.
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
    const heading = await page.locator("h1").innerText();
    await expect(page).toHaveTitle(new RegExp(heading.trim(), "i"));
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
    await expect(
      page.getByRole("heading", {
        name: "Zugriffe prüfen und dieses Gerät autorisieren",
      }),
    ).toBeVisible();
    await expect(page.getByText("Screenshot ausstehend").first()).toBeVisible();

    // Stesso gate del test inglese, e per lo stesso motivo: confrontare con
    // `innerWidth` non funziona, perché quando un elemento sfonda il
    // viewport si allarga e il confronto diventa sempre vero. Il tedesco è
    // il caso che lo ha rivelato — «Einrichtungsanleitung» è una parola
    // sola più larga della colonna.
    const width = await page.evaluate(() => {
      const zoom =
        Number.parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue("--zoom"),
        ) || 1;
      return {
        actual: document.body.scrollWidth,
        expected: (window.visualViewport?.width ?? 390) / zoom,
      };
    });
    expect(
      width.actual,
      `in tedesco la pagina è larga ${width.actual} CSS px invece di ${Math.round(width.expected)}`,
    ).toBeLessThanOrEqual(Math.ceil(width.expected) + 1);
  } finally {
    await context.close();
  }
});
