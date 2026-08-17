import { test, expect } from "@playwright/test";
import {
  cloudOrSkip,
  demoSessionOrSkip,
  openProtected,
} from "./_helpers/protected";

/**
 * FLUSSO 89 — profilo, squadra e swipe nell'area riservata
 *
 * [JHT-E2E-STALE] Le altre tre pagine che l'area protetta serve davvero
 * oggi, scritte da zero contro quello che spedisce oggi: chi sono io
 * (`/profile`), chi lavora per me (`/team`), e il mazzo con cui si scorrono
 * le posizioni (`/swipe`).
 *
 * Le asserzioni sono ancorate ai valori del profilo demo
 * (`web/lib/demo/profile.ts`) e del seed, che stanno nel repo: dicono che la
 * pagina ha reso *quei* dati, non che ha risposto. Una pagina che risponde
 * 200 con lo scheletro di caricamento passerebbe qualunque controllo di
 * status — è la modalità di guasto che ha reso inutili le spec in
 * quarantena.
 */

// Persona "software" — vedi `web/lib/demo/profile.ts`.
const CANDIDATE = {
  name: "Alex Moretti",
  role: "Senior Full-stack Engineer",
  location: "Milano, IT",
  skill: "TypeScript",
};

test.describe("area riservata — profilo, squadra, swipe", () => {
  test.beforeEach(async ({ page }) => {
    await cloudOrSkip(page);
    await demoSessionOrSkip(page);
  });

  test("il profilo rende i dati del candidato", async ({ page }) => {
    await openProtected(page, "/profile");
    const body = page.locator("body");
    await expect(body).toContainText(CANDIDATE.name, { timeout: 15_000 });
    await expect(body).toContainText(CANDIDATE.role);
    await expect(body).toContainText(CANDIDATE.location);
    // Le competenze arrivano da una struttura annidata per categoria: se il
    // renderer le perdesse, la pagina resterebbe in piedi e sembrerebbe sana.
    await expect(body).toContainText(CANDIDATE.skill);
  });

  test("dal cloud il profilo si legge e non si modifica", async ({ page }) => {
    // [JHT-WEB-READONLY] Le modifiche passano dal desktop; sul cloud il
    // pulsante di modifica non viene proprio reso (`!isCloudDeploy()` in
    // profile/page.tsx). È un invariante di sicurezza, non una scelta di
    // layout: merita un test che se ne accorga se un giorno ricompare.
    await openProtected(page, "/profile");
    const body = page.locator("body");
    await expect(body).toContainText(CANDIDATE.name, { timeout: 15_000 });

    // Si guarda il ruolo, non il testo: l'etichetta cambia con la lingua,
    // il fatto che sia un bottone di modifica no. Gli altri bottoni della
    // pagina (esporta, rivela) restano legittimi, quindi il filtro è sul
    // nome accessibile che il pulsante di modifica avrebbe in una qualunque
    // delle sette lingue.
    const editButtons = page.getByRole("button", {
      name: /modific|edit|bearbeit|modifier|editar|szerkeszt/i,
    });
    expect(
      await editButtons.count(),
      "sul cloud il profilo non deve offrire la modifica",
    ).toBe(0);
  });

  test("la pagina della squadra rende l'attività, non solo l'intestazione", async ({
    page,
  }) => {
    await openProtected(page, "/team");
    const body = page.locator("body");
    // L'intestazione porta l'intervallo di date in formato DD/MM/YYYY: è il
    // segno che la query dell'attività ha risposto e non che il guscio è
    // stato servito da solo.
    await expect(body).toContainText(/\d{2}\/\d{2}\/\d{4}/, {
      timeout: 15_000,
    });
    // Almeno un ruolo del team deve comparire: la pagina esiste per dire chi
    // ha lavorato.
    await expect(body).toContainText(/scout|analista|scorer|scrittore/i);
  });

  test("lo swipe presenta una posizione vera del mazzo", async ({ page }) => {
    await openProtected(page, "/swipe");
    const body = page.locator("body");
    // Il mazzo demo non è mai vuoto (56 posizioni nel seed): se comparisse
    // lo stato «finito», vorrebbe dire che il mazzo non è stato caricato —
    // che è un guasto travestito da schermata legittima, il caso peggiore
    // da diagnosticare senza un test che lo distingua.
    await expect(body).toContainText(/Engineer|Developer/i, {
      timeout: 15_000,
    });
  });

  test("la mappa risponde e resta nell'area riservata", async ({ page }) => {
    // La mappa vera non si disegna in headless (serve WebGL: nessun canvas,
    // nessun tile, nessun pin — misurato il 2026-07-25), quindi qui si
    // verifica solo ciò che è verificabile senza mentire sul resto: la
    // pagina risponde e non rimbalza fuori dall'area riservata. Che il
    // dataset abbia coordinate da mostrare è coperto, senza browser, da
    // tests/js/tasks/demo-queries.test.ts.
    await openProtected(page, "/map");
    expect(new URL(page.url()).pathname).toBe("/map");
  });
});
