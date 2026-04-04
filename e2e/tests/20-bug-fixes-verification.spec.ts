import { test, expect } from '@playwright/test';

/**
 * FLUSSO 20 — VERIFICA FIX BUG WEB
 * Documenta il comportamento ATTESO post-fix per i 3 bug trovati
 * nel test E2E Marco Bianchi (task-e2e-003).
 *
 * BUG 1: Workspace selector non redirige alla dashboard dopo conferma
 * BUG 2: Form profilo utente mancante nella web UI
 * BUG 3: Pagina agenti senza istruzioni su come avviarli
 *
 * Selettori aggiornati per matchare la struttura reale dei componenti.
 */

const BASE = process.env.BASE_URL || 'https://jobhunterteam.ai';
const WORKSPACE_PATH = '/tmp/jht-test-workspace';

/** Helper: workspace auth — naviga a /?login=true e completa il setup workspace */
async function doWorkspaceAuth(page: any) {
  await page.goto(`${BASE}/?login=true`, { waitUntil: 'networkidle' });
  const inp = page.locator('input[placeholder="/percorso/alla/cartella"]');
  await expect(inp).toBeVisible({ timeout: 10000 });
  await inp.fill(WORKSPACE_PATH);
  await inp.press('Enter');
  await expect(page.getByText('OK, usa questa cartella')).toBeVisible({ timeout: 5000 });
  await page.getByText('OK, usa questa cartella').click();
  await page.waitForURL((url: URL) => !url.toString().includes('login=true'), { timeout: 15000 });
}

// ─────────────────────────────────────────────────────────────────────────────
// BUG 1 — Workspace selector deve redirigere alla dashboard dopo conferma
// ─────────────────────────────────────────────────────────────────────────────
test.describe('BUG 1 — Workspace selector: redirect alla dashboard', () => {

  test('dopo conferma workspace, URL non è più /?login=true', async ({ page }) => {
    await page.goto(`${BASE}/?login=true`, { waitUntil: 'networkidle' });

    const inp = page.locator('input[placeholder="/percorso/alla/cartella"]');
    await expect(inp).toBeVisible({ timeout: 10000 });
    await inp.fill(WORKSPACE_PATH);
    await inp.press('Enter');

    await expect(page.getByText('OK, usa questa cartella')).toBeVisible({ timeout: 5000 });
    await page.getByText('OK, usa questa cartella').click();

    // ATTESO: navigazione fuori da /?login=true
    await page.waitForURL((url) => !url.toString().includes('login=true'), { timeout: 10000 });
    expect(page.url()).not.toContain('login=true');
  });

  test('dopo conferma workspace, la dashboard o una pagina interna è visibile', async ({ page }) => {
    await doWorkspaceAuth(page);

    // ATTESO: heading principale visibile (es. "Dashboard") — non una pagina di login/setup
    const heading = page.locator('h1, h2').first();
    await expect(heading).toBeVisible({ timeout: 10000 });
    const headingText = await heading.innerText();
    expect(headingText).not.toMatch(/login|workspace|errore/i);
  });

  test('dopo conferma workspace, appare messaggio di successo o benvenuto', async ({ page }) => {
    await page.goto(`${BASE}/?login=true`, { waitUntil: 'networkidle' });

    const inp = page.locator('input[placeholder="/percorso/alla/cartella"]');
    await expect(inp).toBeVisible({ timeout: 10000 });
    await inp.fill(WORKSPACE_PATH);
    await inp.press('Enter');
    await expect(page.getByText('OK, usa questa cartella')).toBeVisible({ timeout: 5000 });
    await page.getByText('OK, usa questa cartella').click();
    await page.waitForTimeout(3000);

    // ATTESO: feedback positivo (toast, cambio pagina con contenuto app)
    const feedback = page.getByText(/workspace.*impostato|configurato|benvenuto|pronto|success/i)
      .or(page.getByText(/dashboard|agenti|sistema|DATI AGGIORNATI/i));
    await expect(feedback.first()).toBeVisible({ timeout: 10000 });
  });

  test('il bottone Sfoglia è presente e cliccabile', async ({ page }) => {
    await page.goto(`${BASE}/?login=true`, { waitUntil: 'networkidle' });

    const sfogliaBtn = page.getByText('Sfoglia');
    await expect(sfogliaBtn).toBeVisible({ timeout: 5000 });
    await expect(sfogliaBtn).toBeEnabled();

    // Click non deve causare errori JavaScript critici
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => jsErrors.push(e.message));
    await sfogliaBtn.click();
    await page.waitForTimeout(800);
    const criticalErrors = jsErrors.filter(e => !/expected|warning|chunk/i.test(e));
    expect(criticalErrors, `Errori JS dopo click Sfoglia: ${criticalErrors.join(', ')}`).toHaveLength(0);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// BUG 2 — Form profilo utente deve essere presente e compilabile
// ─────────────────────────────────────────────────────────────────────────────
test.describe('BUG 2 — Form profilo utente: presente e compilabile', () => {

  // Autenticazione condivisa: ogni test parte già dalla pagina /profile
  test.beforeEach(async ({ page }) => {
    await doWorkspaceAuth(page);
    await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle' });
  });

  test('esiste una pagina o sezione dedicata al profilo utente', async ({ page }) => {
    const body = await page.locator('body').innerText();
    const found = /profilo|profile|nome|name|professione|job title|candidato/i.test(body);
    expect(found, 'Nessuna pagina profilo trovata dopo autenticazione').toBe(true);
  });

  test('form profilo ha campo nome/cognome', async ({ page }) => {
    // Placeholder reale: "Es. Mario Rossi"
    const nameInput = page.locator('input[placeholder="Es. Mario Rossi"]').first();
    await expect(nameInput).toBeVisible({ timeout: 10000 });
  });

  test('form profilo ha campo professione / job title', async ({ page }) => {
    // Placeholder reale: "Es. Backend Developer"
    const jobInput = page.locator('input[placeholder="Es. Backend Developer"]').first();
    await expect(jobInput).toBeVisible({ timeout: 10000 });
  });

  test('form profilo ha campo città / location', async ({ page }) => {
    // Placeholder reale: "Es. Remote EU"
    const locationInput = page.locator('input[placeholder="Es. Remote EU"]').first();
    await expect(locationInput).toBeVisible({ timeout: 10000 });
  });

  test('form profilo ha sezione CV / upload documento', async ({ page }) => {
    // Il file input è hidden; verificare la zona drop visibile con testo "clicca per sfogliare"
    const cvZone = page.getByText(/clicca per sfogliare|carica cv|trascina qui/i).first();
    await expect(cvZone).toBeVisible({ timeout: 10000 });
  });

  test('form profilo ha campo preferenze di ricerca (posizioni target)', async ({ page }) => {
    // Placeholder reale contiene "Backend Developer" come esempio posizioni target
    const prefInput = page.locator('input[placeholder*="Backend Developer"]').first();
    await expect(prefInput).toBeVisible({ timeout: 10000 });
  });

  test('form profilo è salvabile — bottone salva presente', async ({ page }) => {
    // Bottone reale: "SALVA PROFILO"
    const saveBtn = page.locator('button').filter({ hasText: /salva profilo/i }).first();
    await expect(saveBtn).toBeVisible({ timeout: 10000 });
  });

  test('compilazione e salvataggio profilo Marco Bianchi', async ({ page }) => {
    // Usa placeholder reali trovati nella ricognizione DOM
    const nameInput = page.locator('input[placeholder="Es. Mario Rossi"]').first();
    if (await nameInput.count() > 0) await nameInput.fill('Marco Bianchi');

    const jobInput = page.locator('input[placeholder="Es. Backend Developer"]').first();
    if (await jobInput.count() > 0) await jobInput.fill('Architetto');

    const cityInput = page.locator('input[placeholder="Es. Remote EU"]').first();
    if (await cityInput.count() > 0) await cityInput.fill('Milano');

    // Salva
    const saveBtn = page.locator('button').filter({ hasText: /salva profilo/i }).first();
    if (await saveBtn.count() > 0) {
      await expect(saveBtn).toBeEnabled();
      await saveBtn.click();
      await page.waitForTimeout(2000);
      // ATTESO: nessun messaggio di errore dopo il salvataggio
      const errors = page.getByText(/errore|error|failed|impossibile salvare/i);
      expect(await errors.count(), 'Errori visibili dopo il salvataggio profilo').toBe(0);
    }
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// BUG 3 — Pagina agenti: istruzioni chiare per avviare il team
// ─────────────────────────────────────────────────────────────────────────────
test.describe('BUG 3 — Pagina agenti: istruzioni avvio', () => {

  test('pagina /agents mostra stato agenti con feedback visivo chiaro', async ({ page }) => {
    await page.goto(`${BASE}/agents`, { waitUntil: 'networkidle' });

    // La classe reale degli status badge è "badge" (non "status")
    const statusEl = page.locator('.badge').first();
    await expect(statusEl).toBeVisible({ timeout: 10000 });
  });

  test('pagina /agents mostra un messaggio o banner quando tutti gli agenti sono offline', async ({ page }) => {
    await page.goto(`${BASE}/agents`, { waitUntil: 'networkidle' });
    const body = await page.locator('body').innerText();

    // ATTESO: stato "0/N attivi" o badge OFFLINE come feedback chiaro
    const hasStatusInfo = /\d+\/\d+\s*attivi|offline|stopped|non avviato/i.test(body);
    expect(
      hasStatusInfo,
      'Nessun indicatore di stato per agenti offline (atteso "0/N attivi" o badge OFFLINE)'
    ).toBe(true);
  });

  test('pagina /agents ha un link o bottone verso /download quando server non raggiungibile', async ({ page }) => {
    await page.goto(`${BASE}/agents`, { waitUntil: 'networkidle' });

    // ATTESO: link a /download o a documentazione quando gli agenti non sono avviati
    const downloadLink = page.locator(
      'a[href="/download"], a[href*="download"], ' +
      'a[href*="docs"], a[href*="guida"], ' +
      'button:text-matches("scarica|download|installa", "i")'
    ).first();
    await expect(downloadLink).toBeVisible({ timeout: 10000 });
  });

  test('pagina /agents ha informazioni sullo stato del server o elemento di avviso', async ({ page }) => {
    await page.goto(`${BASE}/agents`, { waitUntil: 'networkidle' });

    // ATTESO: elemento [role="alert"] presente, oppure stato "0/N attivi" visibile nel body
    const body = await page.locator('body').innerText();
    const alertEl = page.locator('[role="alert"]');
    const hasStateInfo = /\d+\/\d+\s*attivi/i.test(body)
      || (await alertEl.count()) > 0;
    expect(hasStateInfo, 'Nessuna informazione sullo stato del server/agenti').toBe(true);
  });

  test('bottone ▶ Start su singolo agente mostra tooltip o messaggio se server offline', async ({ page }) => {
    await page.goto(`${BASE}/agents`, { waitUntil: 'networkidle' });

    const startBtn = page.getByText('▶ Start').first();
    await expect(startBtn).toBeVisible({ timeout: 10000 });

    // Click su Start quando server è offline
    await startBtn.click();
    await page.waitForTimeout(1000);

    // ATTESO: messaggio di errore/guida, non silenzio
    const feedback = page.getByText(/server|offline|non raggiungibile|avvia prima|install/i)
      .or(page.locator('[role="alert"], [class*="toast"], [class*="error"], [class*="notification"]').first());
    await expect(feedback.first()).toBeVisible({ timeout: 8000 });
  });

  test('pagina /agents ha sezione "Come avviare" o link a documentazione', async ({ page }) => {
    await page.goto(`${BASE}/agents`, { waitUntil: 'networkidle' });

    const howToLink = page.locator(
      'a:text-matches("come avviare|come iniziare|guida|docs|documentazione|readme|download", "i"), ' +
      'button:text-matches("come avviare|guida", "i"), ' +
      'h2:text-matches("come avviare|come iniziare|istruzioni", "i"), ' +
      'h3:text-matches("come avviare|come iniziare|istruzioni", "i")'
    ).first();
    await expect(howToLink).toBeVisible({ timeout: 10000 });
  });

});
