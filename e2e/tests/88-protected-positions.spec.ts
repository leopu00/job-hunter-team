import { test, expect } from "@playwright/test";
import {
  cloudOrSkip,
  demoSessionOrSkip,
  openProtected,
} from "./_helpers/protected";

/**
 * FLUSSO 88 — le posizioni nell'area riservata
 *
 * [JHT-E2E-STALE] L'area protetta è rimasta quasi senza copertura dopo la
 * quarantena del 2026-07-26 — che ha tolto le spec che *dicevano* di
 * coprirla, non copertura che esisteva. Questa spec è scritta contro le
 * pagine che esistono oggi, non resuscitando file vecchi.
 *
 * La differenza rispetto a `81-demo-mode`, che tocca gli stessi percorsi:
 * lì si verifica che la pagina risponda e si dichiari demo, qui si verifica
 * **che cosa mostra**. Le asserzioni sono ancorate ai valori del seed
 * (`web/lib/demo/seeds/software.ts`), che è versionato nel repo: se la lista
 * smette di rendere titoli e aziende, o il dettaglio perde il punteggio,
 * questi test diventano rossi. «Esiste almeno una riga» non lo avrebbe
 * notato, ed è esattamente il tipo di asserzione che ha lasciato passare
 * settantacinque spec inutili.
 */

// Prime voci del seed "software", nell'ordine del file. L'ordine determina
// gli id, quindi questi valori sono stabili quanto il seed.
const FIRST = { title: "Senior Frontend Engineer", company: "Northstar Labs" };
const SECOND = { title: "Full Stack Product Engineer", company: "AtlasCare" };

test.describe("area riservata — posizioni", () => {
  test.beforeEach(async ({ page }) => {
    await cloudOrSkip(page);
    await demoSessionOrSkip(page);
  });

  test("la lista mostra titolo e azienda delle posizioni, non solo dei link", async ({
    page,
  }) => {
    await openProtected(page, "/positions");

    // `.first()`: la pagina rende due liste (tabella desktop e card mobile) e
    // il CSS ne nasconde una. Si asserisce sulla presenza nel DOM del testo,
    // non sulla visibilità di un nodo che potrebbe essere quello nascosto.
    await expect(
      page.getByText(FIRST.title, { exact: false }).first(),
      "il titolo della prima posizione demo non compare in lista",
    ).toBeAttached({ timeout: 15_000 });
    await expect(
      page.getByText(FIRST.company, { exact: false }).first(),
      "l'azienda della prima posizione demo non compare in lista",
    ).toBeAttached();
    await expect(
      page.getByText(SECOND.title, { exact: false }).first(),
      "la seconda posizione demo non compare in lista",
    ).toBeAttached();
  });

  test("il dettaglio porta il contenuto della posizione, non un guscio", async ({
    page,
  }) => {
    await openProtected(page, "/positions");
    const links = page.locator('a[href*="/positions/demo-"]');
    await expect
      .poll(() => links.count(), {
        message: "nessuna posizione demo in lista",
        timeout: 15_000,
      })
      .toBeGreaterThan(0);

    // Si naviga all'href invece di cliccare: il nodo può essere quello della
    // lista nascosta dal CSS, e il click su un elemento hidden fallirebbe per
    // una ragione che non c'entra con ciò che si sta verificando.
    const href = (await links.first().getAttribute("href")) ?? "";
    expect(href, "link al dettaglio senza href").toBeTruthy();
    await openProtected(page, href);

    // Il contratto delle card ([JHT-POSITION-CARDS]): ogni fatto sta in una
    // card. Qui si pretendono i tre che non possono mancare — che cosa è,
    // presso chi, e quanto vale secondo lo Scorer.
    const body = page.locator("body");
    await expect(body).toContainText(FIRST.title, { timeout: 15_000 });
    await expect(body).toContainText(FIRST.company);
    // Il punteggio della prima posizione nel seed è 91: se il dettaglio
    // rendesse la pagina senza la valutazione, questa riga se ne accorge.
    await expect(body).toContainText("91");
  });

  test("il filtro cambia davvero la lista", async ({ page }) => {
    // Un filtro che non filtra è un difetto invisibile a qualunque test che
    // si limiti a caricare la pagina: la lista è piena in entrambi i casi.
    // `pageSize` fissato su entrambe le richieste: senza, si confronterebbe
    // una PAGINA con un insieme completo. Col default (50) e un seed da 56
    // il conto tornerebbe per caso, e smetterebbe di tornare il giorno in
    // cui il seed cresce o il default cambia — un test che passa per
    // coincidenza è un test che un domani mente.
    await openProtected(page, "/positions?pageSize=200");
    const rows = page.locator('a[href*="/positions/demo-"]');
    await expect
      .poll(() => rows.count(), { timeout: 15_000 })
      .toBeGreaterThan(0);
    const unfiltered = await rows.count();

    // `remote` è un filtro vero della pagina (searchParams, server side):
    // si esercita la stessa strada che percorre la sidebar, senza dipendere
    // dai suoi selettori. Il seed "software" ha 18 posizioni full_remote su
    // 56, quindi il risultato deve essere un sottoinsieme proprio — se
    // fosse uguale, il filtro non sta filtrando.
    await openProtected(page, "/positions?pageSize=200&remote=full_remote");
    await expect
      .poll(() => rows.count(), {
        message: "il filtro remote non ha ristretto la lista",
        timeout: 15_000,
      })
      .toBeLessThan(unfiltered);
    // E deve restare dentro chi ci appartiene: la prima del seed è
    // full_remote, quindi sparire sarebbe l'errore opposto.
    await expect(page.locator("body")).toContainText(FIRST.company);
  });
});
