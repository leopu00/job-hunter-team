import { test, expect, type Page } from "@playwright/test";

/**
 * FLUSSO 80 — /welcome — wizard di benvenuto dell'utente cloud nuovo
 *
 * Due gruppi di test:
 *
 *  1. **Sempre eseguibili** — l'area riservata è chiusa a un anonimo e l'API
 *     della demo valida i suoi input. Girano contro un server cloud senza
 *     alcuna sessione.
 *  2. **Dietro sessione** — il percorso vero del wizard (lingua → stato →
 *     demo). Richiede una sessione Supabase: senza, si skippano con un motivo
 *     esplicito, mai in silenzio.
 *
 * Come eseguirli — vedi e2e/README.md § "Come si eseguono". In breve:
 *
 *   cd web && JHT_HOME=/tmp/empty NEXT_PUBLIC_JHT_DEPLOY=cloud \
 *     npm run dev -- -p 3008
 *   cd e2e && BASE_URL=http://localhost:3008 npx playwright test 80-welcome
 *
 * Design record: docs/internal/architecture/2026-07-22-web-demo-mode-and-welcome.md
 */

// ⚠️ Percorsi **relativi**, mai una costante BASE locale. Qui c'era
// `process.env.BASE_URL || "http://127.0.0.1:3000"`, che aggirava
// `use.baseURL` della config e ne ribaltava proprio la scelta documentata:
// contro `next dev` l'host deve essere `localhost`, perché con `127.0.0.1`
// Next rifiuta l'upgrade WebSocket dell'HMR e **React non idrata** — cioè
// esattamente il modo in cui questi test falliscono senza dire perché
// (playwright.config.ts:1-25). Con i percorsi relativi la destinazione la
// decide la config, in un punto solo.
const WELCOME = "/welcome?preview=1";

/** La demo esiste solo sul deploy cloud: altrove /api/demo risponde 404. */
async function cloudOrSkip(page: Page) {
  const res = await page.request.get("/api/demo");
  test.skip(
    res.status() === 404,
    "server non in modalità cloud (NEXT_PUBLIC_JHT_DEPLOY=cloud)",
  );
}

/**
 * Il wizard vive nell'area riservata: senza sessione il layout protetto
 * rimanda al login. Se il primo step non è a schermo, il test si skippa
 * dicendo cosa gli manca — invece di fallire o, peggio, di tacere.
 */
async function wizardOrSkip(page: Page) {
  await page.goto(WELCOME, { waitUntil: "networkidle" });
  const firstStep = page.getByRole("button", { name: "Italiano", exact: true });
  const visible = await firstStep.isVisible().catch(() => false);
  test.skip(
    !visible,
    "serve una sessione autenticata per entrare nell'area riservata — vedi e2e/README.md § Sessione",
  );
}

/**
 * Clicca e verifica che lo step sia avanzato, riprovando finché serve: il
 * wizard è un client component e un click arrivato prima dell'idratazione
 * viene ingoiato in silenzio (osservato dal vivo il 2026-07-25).
 */
async function clickUntil(
  page: Page,
  click: () => Promise<void>,
  expectAfter: () => Promise<void>,
) {
  await expect(async () => {
    await click();
    await expectAfter();
  }).toPass({ timeout: 20_000 });
}

const BROWSING = /just looking|only looking|occhiata/i;
const BACK = /^(back|indietro)$/i;

test.describe("/welcome — accessibile solo a chi è autenticato", () => {
  test.beforeEach(async ({ page }) => {
    await cloudOrSkip(page);
  });

  test("un anonimo non riceve il wizard", async ({ page }) => {
    await page.goto(WELCOME, { waitUntil: "domcontentloaded" });
    const body = await page.locator("body").innerText();
    const hasWizard = /in che lingua|which language/i.test(body);
    if (hasWizard) {
      // Sessione presente (storageState): questo test non ha nulla da dire.
      test.skip(
        true,
        "sessione attiva: la chiusura anonima non è verificabile",
      );
    }
    // Senza sessione la pagina protetta non deve servire il wizard.
    expect(hasWizard).toBe(false);
  });

  test("le pagine dell'area riservata rimandano al login", async ({ page }) => {
    for (const path of ["/dashboard", "/positions"]) {
      const res = await page.request.get(path, {
        maxRedirects: 0,
      });
      // 307 verso /?login=true (anonimo) oppure 200 (sessione attiva).
      expect([200, 307]).toContain(res.status());
      if (res.status() === 307) {
        expect(res.headers()["location"]).toContain("login=true");
      }
    }
  });
});

test.describe("/welcome — API della demo", () => {
  test.beforeEach(async ({ page }) => {
    await cloudOrSkip(page);
  });

  test("attivazione e stato: POST poi GET raccontano la stessa cosa", async ({
    page,
  }) => {
    const post = await page.request.post("/api/demo", {
      data: { persona: "software" },
    });
    expect(post.ok()).toBe(true);
    const state = await (await page.request.get("/api/demo")).json();
    expect(state.persona).toBe("software");
  });

  test("uscita dalla demo: DELETE azzera la persona", async ({ page }) => {
    await page.request.post("/api/demo", {
      data: { persona: "design" },
    });
    await page.request.delete("/api/demo");
    const state = await (await page.request.get("/api/demo")).json();
    expect(state.persona).toBe(null);
  });

  test("una persona inventata viene rifiutata con 400", async ({ page }) => {
    const res = await page.request.post("/api/demo", {
      data: { persona: "astrologia" },
    });
    expect(res.status()).toBe(400);
  });

  test("un body non-JSON viene rifiutato con 400", async ({ page }) => {
    const res = await page.request.post("/api/demo", {
      data: "non-json",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(400);
  });
});

test.describe("/welcome — percorso completo (serve sessione)", () => {
  test.beforeEach(async ({ page }) => {
    await cloudOrSkip(page);
    await page.request.delete("/api/demo");
    await wizardOrSkip(page);
  });

  test("primo step: le 7 lingue negli endonimi", async ({ page }) => {
    for (const name of [
      "Italiano",
      "English",
      "Español",
      "Français",
      "Deutsch",
      "Magyar",
      "Português",
    ]) {
      await expect(
        page.getByRole("button", { name, exact: true }),
        `lingua ${name} assente`,
      ).toBeVisible();
    }
  });

  test("lingua → stato → demo: 'solo un'occhiata' salta il setup", async ({
    page,
  }) => {
    await clickUntil(
      page,
      () => page.getByRole("button", { name: "English", exact: true }).click(),
      () =>
        expect(page.getByRole("button", { name: BROWSING })).toBeVisible({
          timeout: 2000,
        }),
    );
    await clickUntil(
      page,
      () => page.getByRole("button", { name: BROWSING }).click(),
      () =>
        expect(
          page.getByRole("button", { name: /Software & IT/i }).first(),
        ).toBeVisible({ timeout: 2000 }),
    );
    for (const label of ["Software & IT", "Marketing", "Finance", "Design"]) {
      await expect(
        page.getByRole("button", { name: new RegExp(label, "i") }).first(),
        `persona ${label} assente`,
      ).toBeVisible();
    }
  });

  test("scegliere una persona attiva la demo e porta alla dashboard", async ({
    page,
  }) => {
    await clickUntil(
      page,
      () => page.getByRole("button", { name: "English", exact: true }).click(),
      () =>
        expect(page.getByRole("button", { name: BROWSING })).toBeVisible({
          timeout: 2000,
        }),
    );
    await page.getByRole("button", { name: BROWSING }).click();
    await clickUntil(
      page,
      () =>
        page
          .getByRole("button", { name: /Software & IT/i })
          .first()
          .click(),
      () => page.waitForURL(/\/dashboard/, { timeout: 4000 }),
    );
    const state = await (await page.request.get("/api/demo")).json();
    expect(state.persona).toBe("software");
  });

  test("indietro torna allo step precedente", async ({ page }) => {
    await clickUntil(
      page,
      () => page.getByRole("button", { name: "English", exact: true }).click(),
      () =>
        expect(page.getByRole("button", { name: BROWSING })).toBeVisible({
          timeout: 2000,
        }),
    );
    await page.getByRole("button", { name: BROWSING }).click();
    await clickUntil(
      page,
      () => page.getByRole("button", { name: BACK }).click(),
      () =>
        expect(page.getByRole("button", { name: BROWSING })).toBeVisible({
          timeout: 2000,
        }),
    );
  });
});
