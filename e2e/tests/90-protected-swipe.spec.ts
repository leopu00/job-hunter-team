import { test, expect, type Page } from "@playwright/test";
import {
  cloudOrSkip,
  demoSessionOrSkip,
  openProtected,
} from "./_helpers/protected";

/**
 * FLUSSO 90 — lo swipe si gioca davvero: i bottoni del mazzo
 *
 * [JHT-E2E-STALE] T-028. La 89 verifica che `/swipe` mostri una posizione
 * vera; qui si verifica che il mazzo si GIOCHI: il click su scarta/like fa
 * uscire la card, avanza alla successiva e scrive il giudizio. È la
 * differenza fra «la pagina risponde» e «la pagina funziona» — la stessa
 * che separa queste spec dalle 75 in quarantena.
 *
 * Meccanica verificata con sonda headless prima di scrivere (2026-08-08):
 * lo stack rende la card corrente + le 2 successive, quindi la prova
 * dell'avanzamento non è «il titolo compare» (c'è già) ma:
 *   1. il contatore `idx/total` avanza (1/N → 2/N);
 *   2. il titolo della card giudicata ESCE dal DOM (lo stack è una finestra
 *      di 3: chi esce dalla finestra si smonta);
 *   3. la quarta card del mazzo ENTRA nel DOM (prima non c'era).
 * E la persistenza: in demo il giudizio vive nel cookie overlay
 * (`/api/positions/[legacyId]/feedback` → `jht_demo_feedback`), quindi un
 * reload deve trovare la card giudicata fuori dal mazzo dei da-recensire —
 * il conteggio scende di uno. Se la scrittura si rompesse, il toast
 * d'errore quota il titolo della card e l'asserzione (2) fallirebbe: il
 * test non può passare per caso.
 *
 * I valori attesi vengono dal seed (`web/lib/demo/seeds/software.ts`): il
 * mazzo dei da-recensire è in ordine di arrivo (found_at crescente = `h`
 * decrescente nel seed), quindi la prima card è la `ready`/`scored` con
 * `h` maggiore. Stabili quanto il seed, come per la 88.
 */

// Prime voci del mazzo demo "software" (ordine di arrivo: `h` decrescente
// fra le status ready/scored). FOURTH è la prima FUORI dallo stack iniziale
// di tre: è lei che prova l'avanzamento entrando nel DOM.
const FIRST = "Senior Machine Learning Engineer, NLP"; // h=148, SignalForge
const SECOND = "Lead Fullstack Engineer, Patient Portal"; // h=143, AtlasCare
const FOURTH = "Head of Platform Engineering"; // h=138, GreenGrid

// Le etichette dei giudizi cambiano con la lingua (7 cataloghi in
// SwipeDeck.i18n.ts): il FATTO che sia il bottone di scarto/like no.
// Stessa tecnica della 89 per il bottone di modifica del profilo.
const DISCARD_RE =
  /non interessante|not interesting|nem érdekes|no interesante|uninteressant|pas intéressant|não interessante/i;
const LIKE_RE =
  /molto interessante|very interesting|nagyon érdekes|muy interesante|sehr interessant|très intéressant|muito interessante/i;

/** Il contatore del mazzo: l'unico testo della pagina nella forma `1/25`
 * (ancorato ^…$ perché date e stipendi contengono slash e cifre). */
async function readCounter(page: Page): Promise<[number, number]> {
  const el = page.getByText(/^\d+\/\d+$/);
  await expect(el, "il contatore del mazzo non c'è").toBeAttached({
    timeout: 15_000,
  });
  const [idx, total] = ((await el.textContent()) ?? "").split("/").map(Number);
  expect(Number.isFinite(idx) && Number.isFinite(total)).toBe(true);
  return [idx, total];
}

test.describe("area riservata — swipe interattivo", () => {
  test.beforeEach(async ({ page }) => {
    await cloudOrSkip(page);
    await demoSessionOrSkip(page);
  });

  test("scarta fa uscire la card e il mazzo avanza alla successiva del seed", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));

    await openProtected(page, "/swipe");
    const [idx, total] = await readCounter(page);
    expect(idx, "il mazzo demo non parte dalla prima card").toBe(1);

    // La cima del mazzo è la prima del seed in ordine di arrivo; la quarta
    // non è ancora nel DOM (stack = corrente + 2).
    const body = page.locator("body");
    await expect(body).toContainText(FIRST, { timeout: 15_000 });
    expect(
      await page.getByText(FOURTH).count(),
      "la quarta card è già nel DOM: lo stack rende più di tre card",
    ).toBe(0);

    // Click su scarta: il giudizio deve anche PERSISTERE (in demo: cookie
    // overlay) — se la POST fallisse, il toast d'errore citerebbe il titolo
    // e le asserzioni sotto fallirebbero.
    const [feedback] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/feedback")),
      page.getByRole("button", { name: DISCARD_RE }).click(),
    ]);
    expect(feedback.ok(), "il giudizio non è stato accettato").toBe(true);

    // Avanzamento reale: contatore, uscita della giudicata, ingresso della
    // quarta. I retry di Playwright coprono da sé i 280ms del volo.
    await expect
      .poll(async () => (await readCounter(page))[0], {
        message: "il contatore non è avanzato dopo lo scarto",
      })
      .toBe(idx + 1);
    await expect(
      page.getByText(FIRST),
      "la card scartata è ancora nel DOM",
    ).toHaveCount(0);
    await expect(
      page.getByText(FOURTH),
      "la quarta card non è entrata nello stack",
    ).toBeAttached();
    expect(pageErrors, "errori JS durante lo scarto").toEqual([]);
    expect((await readCounter(page))[1], "il totale non doveva cambiare").toBe(
      total,
    );
  });

  test("like avanza il mazzo e il giudizio sopravvive al reload", async ({
    page,
  }) => {
    await openProtected(page, "/swipe");
    const [, total] = await readCounter(page);

    const [feedback] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/feedback")),
      page.getByRole("button", { name: LIKE_RE }).click(),
    ]);
    expect(feedback.ok(), "il like non è stato accettato").toBe(true);
    await expect
      .poll(async () => (await readCounter(page))[0], {
        message: "il contatore non è avanzato dopo il like",
      })
      .toBe(2);

    // La coerenza vera è dopo il reload: il server rilegge il cookie overlay
    // e la card giudicata passa alle recensite → il mazzo dei da-recensire
    // scende di uno e riparte dalla SECONDA del seed.
    await openProtected(page, "/swipe");
    const [idx2, total2] = await readCounter(page);
    expect(total2, "dopo il reload il mazzo non sconta la card giudicata").toBe(
      total - 1,
    );
    expect(idx2).toBe(1);
    const body = page.locator("body");
    await expect(body).toContainText(SECOND, { timeout: 15_000 });
    await expect(
      page.getByText(FIRST),
      "la card giudicata è ancora fra i da-recensire dopo il reload",
    ).toHaveCount(0);
  });
});
