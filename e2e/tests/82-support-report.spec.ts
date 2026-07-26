import { test, expect, type Locator, type Page } from "@playwright/test";

/**
 * FLUSSO 82 — segnalare un problema
 *
 * Il canale con cui un utente ci dice che qualcosa non funziona, sulle due
 * superfici web: la pagina pubblica `/contact` e il dialogo dell'area
 * riservata. Entrambe parlano con `POST /api/feedback`.
 *
 * Qui si verifica il percorso *nel browser* — che i campi ci siano, che la
 * validazione fermi gli invii inutili, che la conferma compaia. La logica di
 * validazione e resa lato server è coperta senza browser da:
 *
 *   tests/js/validators/feedback-report.test.ts
 *   tests/js/validators/redact.test.ts
 *
 * ⚠️ Con `RESEND_API_KEY` configurata i due test di invio completo recapitano
 * DAVVERO una mail nella casella del progetto, con oggetto prefissato `[e2e]`.
 * È voluto — è l'unico modo di provare la catena intera — ma va saputo prima
 * di lanciare la suite in loop. Senza la chiave il server risponde 503, il
 * modulo mostra l'errore e i test si skippano da soli.
 *
 * I test dell'area riservata richiedono una sessione: senza, si skippano con
 * un motivo esplicito. Ricetta in e2e/README.md § "Sessione".
 */

const BASE = process.env.BASE_URL || "http://localhost:3000";

/**
 * Stato del canale, sondato UNA VOLTA per esecuzione.
 *
 * L'endpoint accetta 5 invii all'ora per IP: una sonda per test esaurirebbe da
 * sola il budget e farebbe fallire proprio i test di invio, dando la colpa al
 * codice invece che alla suite. La sonda usa il campo trappola, così il server
 * risponde senza recapitare niente in casella.
 */
let statoCanale: "ok" | "assente" | "esaurito" | null = null;

async function sondaCanale(page: Page) {
  if (statoCanale) return statoCanale;
  const res = await page.request.post(`${BASE}/api/feedback`, {
    data: {
      client: "e2e-probe",
      happened: "sonda e2e: verifica che il canale sia configurato",
      contact: "e2e@example.org",
      website: "https://esca.example", // honeypot: accettato e non consegnato
    },
    failOnStatusCode: false,
  });
  statoCanale =
    res.status() === 429 ? "esaurito" : res.status() === 200 ? "ok" : "assente";
  return statoCanale;
}

/**
 * Preme invia e riporta lo stato HTTP vero della POST.
 *
 * Serve perché l'esito non dipende solo dal codice: il canale accetta 5 invii
 * all'ora per IP, e una suite che gira due volte di fila incontra il 429. Senza
 * guardare lo status, quel caso si presenterebbe come "il modulo non è
 * sparito", cioè come un bug che non c'è.
 */
async function inviaEStato(page: Page, dentro?: Locator): Promise<number> {
  const ambito = dentro ?? page.locator("body");
  const risposta = page.waitForResponse(
    (r) => r.url().includes("/api/feedback") && r.request().method() === "POST",
  );
  await ambito
    .getByRole("button", { name: /invia|send|enviar|envoyer|senden|küldés/i })
    .click();
  return (await risposta).status();
}

/** Salta il test se un invio vero non è possibile, dicendo perché. */
async function invioPossibileOrSkip(page: Page) {
  const stato = await sondaCanale(page);
  test.skip(
    stato === "esaurito",
    "rate limit orario esaurito (5/ora per IP): riprova fra un'ora",
  );
  test.skip(
    stato === "assente",
    "nessun canale configurato (RESEND_API_KEY): il server risponde 503",
  );
}

/**
 * Apre /contact e non torna finché React non risponde davvero.
 *
 * Con `domcontentloaded` i campi esistono ma sono ancora HTML statico: quello
 * che ci scrivi viene buttato via appena l'hydration installa lo stato React,
 * e il test fallisce mostrando un modulo vuoto. La prova che l'hydration è
 * finita è che un pulsante *reagisca*: le categorie sono governate da stato
 * React, quindi `aria-pressed` cambia solo dopo.
 *
 * Chiude anche il banner dei cookie, che altrimenti copre il pulsante di invio.
 */
async function apriModulo(page: Page) {
  await page.goto(`${BASE}/contact`, { waitUntil: "domcontentloaded" });
  const categorie = page.locator("fieldset button[aria-pressed]");
  await categorie.first().waitFor();
  const seconda = categorie.nth(1);
  await seconda.click();
  await expect(seconda).toHaveAttribute("aria-pressed", "true");

  const cookie = page.getByRole("button", { name: /accept|accetta/i });
  if (await cookie.count()) await cookie.first().click();
}

async function sessioneOrSkip(page: Page) {
  const dash = await page.request.get(`${BASE}/dashboard`, { maxRedirects: 0 });
  test.skip(
    dash.status() === 307,
    "serve una sessione autenticata per l'area riservata — vedi e2e/README.md § Sessione",
  );
}

test.describe("pagina pubblica /contact", () => {
  test("il modulo ha i campi che servono", async ({ page }) => {
    await page.goto(`${BASE}/contact`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#c-nome")).toBeVisible();
    await expect(page.locator("#c-email")).toBeVisible();
    await expect(page.locator("#c-oggetto")).toBeVisible();
    await expect(page.locator("#c-msg")).toBeVisible();
    // Le quattro categorie: senza, la casella non si smista a colpo d'occhio.
    await expect(page.getByRole("button", { pressed: true })).toHaveCount(1);
  });

  test("gli indirizzi sono cliccabili, per chi preferisce il suo client", async ({
    page,
  }) => {
    await page.goto(`${BASE}/contact`, { waitUntil: "domcontentloaded" });
    await expect(
      page.locator('a[href="mailto:support@jobhunterteam.ai"]'),
    ).toBeVisible();
    await expect(
      page.locator('a[href="mailto:security@jobhunterteam.ai"]'),
    ).toBeVisible();
  });

  test("il campo trappola resta fuori dallo schermo e dagli screen reader", async ({
    page,
  }) => {
    await page.goto(`${BASE}/contact`, { waitUntil: "domcontentloaded" });
    const esca = page.locator("#c-website");
    await expect(esca).toHaveCount(1);
    // Non `toBeHidden()`: è fuori viewport ma tecnicamente renderizzato. Ciò
    // che conta è che nessun umano ci arrivi — né a vista né in tabulazione.
    await expect(esca).toHaveAttribute("tabindex", "-1");
    await expect(
      page.locator('div[aria-hidden="true"] #c-website'),
    ).toHaveCount(1);
  });

  test("email non valida: si ferma prima di partire", async ({ page }) => {
    await apriModulo(page);
    await page.locator("#c-email").fill("non-una-mail");
    await page.locator("#c-oggetto").fill("Prova di validazione");
    await page.locator("#c-msg").fill("Messaggio abbastanza lungo da passare.");
    await page
      .getByRole("button", { name: /invia|send|enviar|envoyer|senden|küldés/i })
      .click();
    // L'errore deve parlare dell'EMAIL: asserire solo "il modulo è ancora lì"
    // passerebbe anche se il campo fosse rimasto vuoto per un problema di
    // hydration, cioè per il motivo sbagliato.
    await expect(page.getByText(/email|correo|e-mail/i).last()).toBeVisible();
    await expect(page.locator("#c-msg")).toBeVisible();
  });

  test("messaggio troppo corto: si ferma prima di partire", async ({
    page,
  }) => {
    await apriModulo(page);
    await page.locator("#c-email").fill("utente@example.org");
    await page.locator("#c-oggetto").fill("Oggetto valido");
    await page.locator("#c-msg").fill("corto");
    await page
      .getByRole("button", { name: /invia|send|enviar|envoyer|senden|küldés/i })
      .click();
    await expect(
      page.getByText(/corto|short|kurz|court|curta|rövid/i).last(),
    ).toBeVisible();
    await expect(page.locator("#c-msg")).toBeVisible();
  });

  test("invio completo: la conferma sostituisce il modulo", async ({
    page,
  }) => {
    await invioPossibileOrSkip(page);
    await apriModulo(page);
    await page.locator("#c-nome").fill("Utente E2E");
    await page.locator("#c-email").fill("e2e@example.org");
    await page.locator("#c-oggetto").fill("[e2e] invio dal modulo pubblico");
    await page
      .locator("#c-msg")
      .fill("Messaggio di prova generato dalla suite end-to-end. Ignorare.");
    const stato = await inviaEStato(page);
    test.skip(stato === 429, "rate limit orario esaurito (5/ora per IP)");
    expect(stato, "l'endpoint ha rifiutato l'invio").toBe(200);
    // Il modulo sparisce e resta il riferimento del ticket.
    await expect(page.locator("#c-msg")).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByText(/JHT-[0-9A-Z]+|#\d+/).first()).toBeVisible();
  });
});

test.describe("dialogo dell'area riservata", () => {
  test.beforeEach(async ({ page }) => {
    await sessioneOrSkip(page);
  });

  test("si apre dal menu utente e sa già chi sei", async ({ page }) => {
    await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /account:/i }).click();
    await page
      .getByRole("menuitem", {
        name: /segnala|report a problem|informar|signaler|problem melden|hiba|comunicar/i,
      })
      .click();

    const dialogo = page.getByRole("dialog");
    await expect(dialogo).toBeVisible();
    // Niente campo email: chi scrive è autenticato, l'indirizzo lo sappiamo.
    await expect(dialogo.locator('input[type="email"]')).toHaveCount(0);
    await expect(dialogo.locator("#s-oggetto")).toBeVisible();
    await expect(dialogo.locator("#s-msg")).toBeVisible();
  });

  test("mostra la pagina che allega, invece di allegarla di nascosto", async ({
    page,
  }) => {
    await page.goto(`${BASE}/positions`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /account:/i }).click();
    await page
      .getByRole("menuitem", {
        name: /segnala|report a problem|informar|signaler|problem melden|hiba|comunicar/i,
      })
      .click();
    // È il contesto che rende un report riproducibile, e l'utente deve poterlo
    // leggere prima di premere invia.
    await expect(
      page.getByRole("dialog").getByText("/positions"),
    ).toBeVisible();
  });

  test("si chiude con Escape", async ({ page }) => {
    await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /account:/i }).click();
    await page
      .getByRole("menuitem", {
        name: /segnala|report a problem|informar|signaler|problem melden|hiba|comunicar/i,
      })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("invio completo: conferma dentro il dialogo", async ({ page }) => {
    await invioPossibileOrSkip(page);
    await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /account:/i }).click();
    await page
      .getByRole("menuitem", {
        name: /segnala|report a problem|informar|signaler|problem melden|hiba|comunicar/i,
      })
      .click();

    const dialogo = page.getByRole("dialog");
    await dialogo.locator("#s-oggetto").fill("[e2e] invio dalla dashboard");
    await dialogo
      .locator("#s-msg")
      .fill("Segnalazione di prova generata dalla suite end-to-end. Ignorare.");
    const stato = await inviaEStato(page, dialogo);
    test.skip(stato === 429, "rate limit orario esaurito (5/ora per IP)");
    expect(stato, "l'endpoint ha rifiutato l'invio").toBe(200);
    await expect(dialogo.locator("#s-msg")).toHaveCount(0, { timeout: 15_000 });
  });
});
