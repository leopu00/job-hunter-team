import { test, expect, type Page } from "@playwright/test";

/**
 * FLUSSO 81 — demo mode dell'area riservata cloud
 *
 * Con la demo attiva ogni pagina dell'area riservata serve il dataset statico
 * della persona scelta. Qui si verifica end-to-end che *le pagine* lo mostrino;
 * il contenuto del dataset e la logica delle query sono coperti — senza
 * browser e senza sessione — da:
 *
 *   tests/js/tasks/demo-seeds.test.ts          (contratto dei seed)
 *   tests/js/tasks/demo-queries.test.ts        (query che alimentano le pagine)
 *   tests/js/tasks/demo-feedback-cookie.test.ts (giudizio nel cookie overlay)
 *
 * I test di questo file richiedono una sessione autenticata (l'area riservata
 * la pretende): senza, si skippano con un motivo esplicito. Ricetta in
 * e2e/README.md § "Sessione".
 *
 * Design record: docs/internal/architecture/2026-07-22-web-demo-mode-and-welcome.md
 */

// ⚠️ Percorsi **relativi**, mai una costante BASE locale: la destinazione la
// decide `use.baseURL` della config. Il default che stava qui
// (`http://127.0.0.1:3000`) ribaltava la scelta documentata in
// playwright.config.ts:1-25 — contro `next dev`, con `127.0.0.1`, React non
// idrata affatto e i click di questi test spariscono nel nulla.
const PERSONA = "software";

async function cloudOrSkip(page: Page) {
  const res = await page.request.get("/api/demo");
  test.skip(
    res.status() === 404,
    "server non in modalità cloud (NEXT_PUBLIC_JHT_DEPLOY=cloud)",
  );
}

/** Attiva la demo e verifica di poter entrare nell'area riservata. */
async function demoSessionOrSkip(page: Page) {
  const res = await page.request.post("/api/demo", {
    data: { persona: PERSONA },
  });
  expect(res.ok(), "POST /api/demo non ha attivato la demo").toBe(true);

  const dash = await page.request.get("/dashboard", { maxRedirects: 0 });
  test.skip(
    dash.status() === 307,
    "serve una sessione autenticata per l'area riservata — vedi e2e/README.md § Sessione",
  );
}

test.describe("demo mode — pagine", () => {
  test.beforeEach(async ({ page }) => {
    await cloudOrSkip(page);
    await demoSessionOrSkip(page);
  });

  test("la banda 'dati di esempio' compare su ogni pagina", async ({
    page,
  }) => {
    for (const path of ["/dashboard", "/positions", "/map"]) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await expect(
        page.getByText(/demo/i).first(),
        `banda demo assente su ${path}`,
      ).toBeVisible();
    }
  });

  test("positions: la lista contiene solo posizioni demo", async ({ page }) => {
    await page.goto("/positions", { waitUntil: "domcontentloaded" });
    const demoLinks = page.locator('a[href*="/positions/demo-"]');
    // Si aspetta il *conteggio*, non la visibilità: la pagina rende due liste
    // (tabella desktop e card mobile) e una delle due è nascosta dal CSS, per
    // cui `.first()` può risolvere su un nodo hidden anche quando la lista c'è
    // (misurato 2026-07-25 contro `next start`).
    //
    // È anche l'attesa che sostituisce `networkidle`: subito dopo
    // `domcontentloaded` la lista non è ancora arrivata (la pagina è un server
    // component servito in streaming, e prima del suo chunk c'è lo scheletro di
    // loading.tsx) — contando una volta sola si leggeva 0. `expect.poll`
    // riprova fino a 10s, quindi aspetta il dato invece dell'inattività della
    // rete.
    await expect
      .poll(() => demoLinks.count(), {
        message: "nessuna posizione demo in lista",
        timeout: 10_000,
      })
      .toBeGreaterThan(0);
    for (const a of await page.locator('a[href^="/positions/"]').all()) {
      const href = (await a.getAttribute("href")) ?? "";
      if (/\/positions\/[^/?#]+$/.test(href)) {
        expect(href, `link non demo: ${href}`).toContain("/positions/demo-");
      }
    }
  });

  test("dettaglio: la prima posizione demo si apre", async ({ page }) => {
    await page.goto("/positions", { waitUntil: "domcontentloaded" });
    const links = page.locator('a[href*="/positions/demo-"]');
    // Come sopra: il poll è l'attesa esplicita che sostituisce `networkidle`.
    await expect
      .poll(() => links.count(), {
        message: "nessuna posizione demo in lista",
        timeout: 10_000,
      })
      .toBeGreaterThan(0);
    // L'href basta anche se il nodo è nascosto: si naviga all'URL, non si clicca.
    const href = (await links.first().getAttribute("href")) ?? "";
    expect(href).toBeTruthy();
    const res = await page.goto(href, {
      waitUntil: "domcontentloaded",
    });
    expect(res?.status()).toBe(200);
  });

  test("map e swipe rispondono e sono etichettate come demo", async ({
    page,
  }) => {
    // NB su /map: la mappa vera non si renderizza in headless (nessun canvas,
    // nessun tile, nessun pin — misurato il 2026-07-25: servirebbe WebGL, che
    // il browser headless non espone). È un limite dell'ambiente, non del
    // prodotto, quindi qui si verifica ciò che *è* verificabile: la pagina
    // risponde e si dichiara demo. Il fatto che il dataset abbia coordinate da
    // mostrare è coperto da tests/js/tasks/demo-queries.test.ts.
    for (const path of ["/map", "/swipe"]) {
      const res = await page.goto(path, {
        waitUntil: "domcontentloaded",
      });
      expect(res?.status(), `${path} non risponde 200`).toBe(200);
      // L'attesa al posto di `networkidle` è l'asserzione stessa: `toBeVisible`
      // riprova finché la banda non compare (su /map, poi, la rete non tace mai
      // davvero — i tile continuano a chiedere).
      await expect(
        page.getByText(/demo/i).first(),
        `${path} senza banda demo`,
      ).toBeVisible();
    }
  });

  test("cambiare persona cambia il dataset servito", async ({ page }) => {
    await page.request.post("/api/demo", {
      data: { persona: "design" },
    });
    await page.goto("/positions", { waitUntil: "domcontentloaded" });
    const demoLinks = page.locator('a[href*="/positions/demo-"]');
    await expect
      .poll(() => demoLinks.count(), {
        message: "nessuna posizione demo in lista",
        timeout: 10_000,
      })
      .toBeGreaterThan(0);
    const hrefs = await demoLinks.evaluateAll((els) =>
      els.map((e) => e.getAttribute("href") ?? ""),
    );
    expect(hrefs.length).toBeGreaterThan(0);
    expect(
      hrefs.every((h) => h.includes("demo-design-")),
      "la lista mescola posizioni di personas diverse",
    ).toBe(true);
  });

  test("senza demo attiva le pagine non mostrano dati finti", async ({
    page,
  }) => {
    await page.request.delete("/api/demo");
    await page.goto("/positions", { waitUntil: "domcontentloaded" });
    // Un'asserzione di assenza deve dare tempo a ciò che nega di comparire, e
    // qui il tempo non si misura in millisecondi: si aspetta un elemento che
    // arriva **insieme** alla lista. Il titolo della pagina sta nello stesso
    // chunk della tabella (page.tsx li rende entrambi) e lo scheletro di
    // loading.tsx non ha intestazioni, quindi vederlo significa che il
    // contenuto vero è arrivato — e che contare zero link demo è una risposta,
    // non l'ombra di una pagina non ancora renderizzata.
    await expect(
      page.getByRole("heading", { level: 1 }),
      "la pagina /positions non è arrivata: il conteggio non direbbe nulla",
    ).toBeVisible({ timeout: 15_000 });
    expect(await page.locator('a[href*="/positions/demo-"]').count()).toBe(0);
  });
});
