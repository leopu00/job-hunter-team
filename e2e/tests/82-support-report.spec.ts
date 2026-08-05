import { test, expect, type Locator, type Page } from "@playwright/test";

/**
 * FLUSSO 82 — segnalare un problema
 *
 * Il canale con cui un utente ci dice che qualcosa non funziona, sulle due
 * superfici web: la pagina pubblica `/contact` e il dialogo dell'area
 * riservata. Entrambe parlano con `POST /api/feedback`.
 *
 * Qui si verifica il percorso *nel browser* — che basti il racconto, che
 * l'anteprima espliciti i metadati, che la validazione fermi gli invii inutili
 * e che ticket o errore di rete dicano la verità. La logica di validazione e
 * resa lato server è coperta senza browser da:
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

// ⚠️ Percorsi **relativi**, mai una costante BASE locale: la destinazione la
// decide `use.baseURL` della config, che è anche dove vive la scelta di
// `localhost` invece di `127.0.0.1` (playwright.config.ts:1-25).

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
  const res = await page.request.post("/api/feedback", {
    data: {
      client: "web-contact",
      kind: "bug",
      happened: "sonda e2e: verifica che il canale sia configurato",
      platform: "web",
      locale: "it",
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
 * finita è che un campo *reagisca*: il textarea è governato da stato React,
 * quindi il suo valore cambia solo dopo.
 *
 * Chiude anche il banner dei cookie, che altrimenti copre il pulsante di invio.
 */
async function apriModulo(page: Page) {
  await page.goto("/contact", { waitUntil: "domcontentloaded" });
  const messaggio = page.locator("#c-msg");
  await messaggio.waitFor();
  await messaggio.fill("Verifica che il modulo sia pronto dopo l'hydration.");
  await expect(messaggio).toHaveValue(/Verifica che il modulo/);
  await messaggio.fill("");

  const cookie = page.getByRole("button", { name: /accept|accetta/i });
  if (await cookie.count()) await cookie.first().click();
}

async function sessioneOrSkip(page: Page) {
  const dash = await page.request.get("/dashboard", { maxRedirects: 0 });
  test.skip(
    dash.status() === 307,
    "serve una sessione autenticata per l'area riservata — vedi e2e/README.md § Sessione",
  );
}

/**
 * Il wizard di primo avvio prende il posto della pagina richiesta.
 *
 * `/welcome` non è un redirect del server — `/dashboard` risponde 200 — ma un
 * dirottamento del client dopo l'idratazione, quindi nessuna guardia basata
 * sullo status HTTP può vederlo. Una sessione appena creata (il CI la rigenera
 * a ogni run) è per definizione una sessione che il wizard non ha ancora visto.
 *
 * Il sintomo, se non lo si gestisce, è illeggibile: il test aspetta trenta
 * secondi il menu della dashboard mentre a schermo c'è un selettore di lingua,
 * e fallisce come se fosse rotto il dialogo di segnalazione. Diagnosticato il
 * 2026-07-29 dallo screenshot di Playwright, dopo due tentativi a vuoto su
 * ipotesi sbagliate.
 *
 * Il wizard offre lui stesso la via d'uscita, ed è quella che si usa qui.
 */
async function superaWizard(page: Page) {
  // Il redirect al wizard è client-side, quindi subito dopo `goto` la pagina
  // mente due volte: l'URL è ancora quello chiesto e il wizard non è montato.
  //
  // Due tentativi già falliti su questa stessa riga, per la stessa ragione di
  // fondo — decidere su un segnale letto TROPPO PRESTO:
  //   · un `count()` istantaneo sul pulsante restituiva 0 e ci lasciava dentro
  //     il wizard credendo di averlo saltato;
  //   · aspettare l'URL non serve a niente se il pattern include anche la meta
  //     richiesta: dopo `goto('/dashboard')` l'URL È già `/dashboard`, la
  //     waitForURL passa nello stesso istante e il controllo su `/welcome`
  //     esce prima che il redirect sia partito. Gara spostata, non vinta:
  //     verde il 30/07 la mattina, rossa lo stesso giorno il pomeriggio.
  //
  // Da lì il fallimento non somiglia più alla sua causa: il wizard disegna la
  // navbar, quindi il menu utente si apre e la voce esiste davvero, ma il
  // re-render la stacca e il click resta appeso 30 secondi. Il rosso parlava
  // del menu; il menu non c'entrava nulla.
  //
  // Quindi non si guarda più né l'URL né il conteggio: si aspetta l'ESITO,
  // cioè che il pulsante del wizard si manifesti entro un tempo onesto. Se
  // compare siamo nel wizard e lo saltiamo; se non compare il wizard non c'è,
  // e l'attesa era il prezzo per saperlo con certezza invece che per fortuna.
  const salta = page.getByRole("button", {
    name: /salta|skip|saltar|passer|überspringen|kihagy/i,
  });
  const nelWizard = await salta
    .first()
    .waitFor({ state: "visible", timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (!nelWizard) return;

  // È un <button> con onClick, non un <a>: il wizard naviga da codice.
  await salta.first().click();
  await page.waitForURL(/\/dashboard|\/positions|\/map/, { timeout: 15_000 });
  // Il redirect cambia l'URL prima che la pagina nuova sia interattiva: senza
  // questo, il click successivo sul menu utente può ancora colpire il DOM del
  // wizard in smontaggio.
  await page.waitForLoadState("domcontentloaded");
}

// Apre il dialogo dal menu utente. Menu e dialogo sono due passaggi distinti:
// senza attendere che la voce sia davvero visibile il click parte mentre il
// menu è ancora in apertura, e Playwright resta 30 secondi su un elemento che
// non riceve eventi. Fallimento intermittente in CI il 2026-07-27 — lo stesso
// test era passato in 2.4s quattordici minuti prima.
async function apriDialogo(page: Page, da = "/dashboard") {
  await page.goto(da, { waitUntil: "domcontentloaded" });
  await superaWizard(page);
  if (!page.url().includes(da)) {
    await page.goto(da, { waitUntil: "domcontentloaded" });
  }
  const account = page.getByRole("button", { name: /account:/i });
  await account.waitFor({ state: "visible" });
  await account.click();
  const voce = page.getByRole("menuitem", {
    name: /segnala|report a problem|informar|signaler|problem melden|hiba|comunicar/i,
  });
  await voce.waitFor({ state: "visible" });
  await voce.click();
  const dialogo = page.getByRole("dialog");
  await expect(dialogo).toBeVisible();
  return dialogo;
}

test.describe("pagina pubblica /contact", () => {
  test("il modulo chiede solo il problema e mostra i dati inviati", async ({
    page,
  }) => {
    await page.goto("/contact", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#c-msg")).toBeVisible();
    await expect(page.locator("#c-nome, #c-email, #c-oggetto")).toHaveCount(0);
    await expect(
      page.getByText(/dati inviati|data being sent|datos enviados/i),
    ).toBeVisible();
    await expect(page.getByText(/CV|résumé|Lebenslauf/i).first()).toBeVisible();
  });

  test("gli indirizzi sono cliccabili, per chi preferisce il suo client", async ({
    page,
  }) => {
    await page.goto("/contact", { waitUntil: "domcontentloaded" });
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
    await page.goto("/contact", { waitUntil: "domcontentloaded" });
    const esca = page.locator("#c-website");
    await expect(esca).toHaveCount(1);
    // Non `toBeHidden()`: è fuori viewport ma tecnicamente renderizzato. Ciò
    // che conta è che nessun umano ci arrivi — né a vista né in tabulazione.
    await expect(esca).toHaveAttribute("tabindex", "-1");
    await expect(
      page.locator('div[aria-hidden="true"] #c-website'),
    ).toHaveCount(1);
  });

  test("messaggio troppo corto: si ferma prima di partire", async ({
    page,
  }) => {
    await apriModulo(page);
    await page.locator("#c-msg").fill("corto");
    await page
      .getByRole("button", { name: /invia|send|enviar|envoyer|senden|küldés/i })
      .click();
    await expect(
      page.getByText(/corto|short|kurz|court|curta|rövid/i).last(),
    ).toBeVisible();
    await expect(page.locator("#c-msg")).toBeVisible();
  });

  test("offline: chiarisce che non ha inviato nulla", async ({ page }) => {
    await apriModulo(page);
    await page.route("**/api/feedback", (route) =>
      route.abort("internetdisconnected"),
    );
    await page
      .locator("#c-msg")
      .fill("Segnalazione di prova per il comportamento senza connessione.");
    await page
      .getByRole("button", { name: /invia|send|enviar|envoyer|senden|küldés/i })
      .click();
    await expect(page.locator("form").getByRole("alert")).toHaveText(
      /offline|connessione|connection|niente|nothing|nada|rien/i,
    );
  });

  test("503: non scambia un canale indisponibile per offline", async ({
    page,
  }) => {
    await apriModulo(page);
    await page.route("**/api/feedback", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ ok: false }),
      }),
    );
    await page
      .locator("#c-msg")
      .fill(
        "Segnalazione di prova per un canale temporaneamente indisponibile.",
      );
    await page
      .getByRole("button", { name: /invia|send|enviar|envoyer|senden|küldés/i })
      .click();

    const alert = page.locator("form").getByRole("alert");
    await expect(alert).toHaveText(
      /non.{0,20}inviat|not sent|no se ha enviado|pas envoyé|nicht gesendet|nem lett elküldve|não foi enviada/i,
    );
    await expect(alert).not.toHaveText(
      /offline|connessione|connection|niente|nothing|nada|rien/i,
    );
  });

  test("invia solo il contesto dichiarato e conferma con il ticket", async ({
    page,
  }) => {
    await apriModulo(page);
    let payload: Record<string, unknown> | null = null;
    await page.route("**/api/feedback", async (route) => {
      payload = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, ticket: "JHT-E2E" }),
      });
    });
    await page
      .locator("#c-msg")
      .fill("Segnalazione di prova per verificare il payload anonimo.");
    const stato = await inviaEStato(page);
    expect(stato).toBe(200);
    expect(payload).toMatchObject({
      client: "web-contact",
      kind: "bug",
      happened: "Segnalazione di prova per verificare il payload anonimo.",
      doing: "Public web report: /contact",
      platform: "web",
    });
    expect(payload).not.toHaveProperty("contact");
    expect(payload).not.toHaveProperty("email");
    expect(payload).not.toHaveProperty("name");
    await expect(page.getByText("JHT-E2E")).toBeVisible();
  });

  test("invio completo: la conferma sostituisce il modulo", async ({
    page,
  }) => {
    await invioPossibileOrSkip(page);
    await apriModulo(page);
    await page
      .locator("#c-msg")
      .fill(
        "[e2e] Messaggio di prova generato dalla suite end-to-end. Ignorare.",
      );
    const stato = await inviaEStato(page);
    test.skip(stato === 429, "rate limit orario esaurito (5/ora per IP)");
    // 503 = nessuna destinazione configurata: la route lo restituisce quando
    // casella, issue e webhook sono tutti assenti o giù, invece di finta
    // conferma. In CI i segreti di consegna non esistono, quindi è lo stato
    // atteso e non un difetto — dove il canale è configurato il test verifica
    // l'invio per davvero. Qualunque altro stato resta un fallimento.
    test.skip(
      stato === 503,
      "canale di assistenza non configurato in questo ambiente (nessun RESEND/mailbox/webhook)",
    );
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

  test("si apre dal menu utente e chiede solo il problema", async ({
    page,
  }) => {
    const dialogo = await apriDialogo(page);
    // L'identità dell'account non è contesto tecnico; il ticket può usare il
    // racconto senza prendere un recapito o richiedere un oggetto.
    await expect(dialogo.locator('input[type="email"]')).toHaveCount(0);
    await expect(dialogo.locator("#s-oggetto")).toHaveCount(0);
    await expect(dialogo.locator("#s-msg")).toBeVisible();
    await expect(
      dialogo.getByText(/dati inviati|data being sent|datos enviados/i),
    ).toBeVisible();
  });

  test("mostra la pagina che allega, invece di allegarla di nascosto", async ({
    page,
  }) => {
    const dialogo = await apriDialogo(page, "/positions");
    // È il contesto che rende un report riproducibile, e l'utente deve poterlo
    // leggere prima di premere invia.
    await expect(dialogo.getByText("/positions")).toBeVisible();
  });

  test("offline: chiarisce che non ha inviato nulla", async ({ page }) => {
    const dialogo = await apriDialogo(page);
    await page.route("**/api/feedback", (route) =>
      route.abort("internetdisconnected"),
    );
    await dialogo
      .locator("#s-msg")
      .fill("Segnalazione di prova per il comportamento senza connessione.");
    await dialogo
      .getByRole("button", { name: /invia|send|enviar|envoyer|senden|küldés/i })
      .click();
    await expect(dialogo.getByRole("alert")).toHaveText(
      /offline|connessione|connection|niente|nothing|nada|rien/i,
    );
  });

  test("si chiude con Escape", async ({ page }) => {
    const dialogo = await apriDialogo(page);
    await page.keyboard.press("Escape");
    await expect(dialogo).toHaveCount(0);
  });

  test("invio completo: conferma dentro il dialogo", async ({ page }) => {
    await invioPossibileOrSkip(page);
    const dialogo = await apriDialogo(page);
    await dialogo
      .locator("#s-msg")
      .fill(
        "[e2e] Segnalazione di prova generata dalla suite end-to-end. Ignorare.",
      );
    const stato = await inviaEStato(page, dialogo);
    test.skip(stato === 429, "rate limit orario esaurito (5/ora per IP)");
    test.skip(
      stato === 503,
      "canale di assistenza non configurato in questo ambiente (nessun RESEND/mailbox/webhook)",
    );
    expect(stato, "l'endpoint ha rifiutato l'invio").toBe(200);
    await expect(dialogo.locator("#s-msg")).toHaveCount(0, { timeout: 15_000 });
  });
});
