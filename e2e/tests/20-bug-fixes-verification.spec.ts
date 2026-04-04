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
 * Questi test FALLISCONO finché i fix non sono in produzione.
 * Quando passano tutti → i bug sono risolti.
 */

const BASE = process.env.BASE_URL || 'https://jobhunterteam.ai';
const WORKSPACE_PATH = '/tmp/jht-test-workspace';

// ─────────────────────────────────────────────────────────────────────────────
// BUG 1 — Workspace selector deve redirigere alla dashboard dopo conferma
// ─────────────────────────────────────────────────────────────────────────────
test.describe('BUG 1 — Workspace selector: redirect alla dashboard', () => {

  test('dopo conferma workspace, URL non è più /?login=true', async ({ page }) => {
    await page.goto(`${BASE}/?login=true`, { waitUntil: 'networkidle' });

    // Inserisce path e conferma
    const inp = page.locator('input[placeholder="/percorso/alla/cartella"]');
    await expect(inp).toBeVisible({ timeout: 10000 });
    await inp.fill(WORKSPACE_PATH);
    await inp.press('Enter');

    // Attende modal
    await expect(page.getByText('OK, usa questa cartella')).toBeVisible({ timeout: 5000 });
    await page.getByText('OK, usa questa cartella').click();

    // ATTESO: navigazione fuori da /?login=true
    await page.waitForURL((url) => !url.toString().includes('login=true'), { timeout: 10000 });
    expect(page.url()).not.toContain('login=true');
  });

  test('dopo conferma workspace, la dashboard o una pagina interna è visibile', async ({ page }) => {
    await page.goto(`${BASE}/?login=true`, { waitUntil: 'networkidle' });

    const inp = page.locator('input[placeholder="/percorso/alla/cartella"]');
    await expect(inp).toBeVisible({ timeout: 10000 });
    await inp.fill(WORKSPACE_PATH);
    await inp.press('Enter');
    await expect(page.getByText('OK, usa questa cartella')).toBeVisible({ timeout: 5000 });
    await page.getByText('OK, usa questa cartella').click();

    // ATTESO: sidebar o dashboard visibile dopo conferma
    await page.waitForURL((url) => !url.toString().includes('login=true'), { timeout: 10000 });
    const dashboard = page.locator(
      'nav, aside, [role="navigation"], ' +
      '[class*="sidebar"], [class*="dashboard"], ' +
      'text=Agenti, text=Dashboard'
    ).first();
    await expect(dashboard).toBeVisible({ timeout: 10000 });
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

    // ATTESO: feedback positivo (toast, messaggio, o cambio pagina)
    const feedback = page.getByText(/workspace.*impostato|configurato|benvenuto|pronto|success/i)
      .or(page.getByText(/dashboard|agenti|sistema/i));
    await expect(feedback.first()).toBeVisible({ timeout: 10000 });
  });

  test('il bottone Sfoglia apre una UI di selezione cartella utilizzabile da browser', async ({ page }) => {
    await page.goto(`${BASE}/?login=true`, { waitUntil: 'networkidle' });

    const sfogliaBtn = page.getByText('Sfoglia');
    await expect(sfogliaBtn).toBeVisible({ timeout: 5000 });
    await sfogliaBtn.click();
    await page.waitForTimeout(1000);

    // ATTESO: appare un picker UI (non file dialog nativo), oppure un input si attiva
    const picker = page.locator(
      '[role="dialog"], [class*="picker"], [class*="file-browser"], ' +
      'input[type="text"]:not([placeholder="/percorso/alla/cartella"])'
    ).first();
    // Alternativa accettabile: l'input di testo diventa focused/attivo
    const inputFocused = await page.locator('input[placeholder="/percorso/alla/cartella"]')
      .evaluate((el: HTMLElement) => document.activeElement === el);
    expect(
      (await picker.count()) > 0 || inputFocused,
      'Sfoglia non produce UI navigabile da browser'
    ).toBe(true);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// BUG 2 — Form profilo utente deve essere presente e compilabile
// ─────────────────────────────────────────────────────────────────────────────
test.describe('BUG 2 — Form profilo utente: presente e compilabile', () => {

  test('esiste una pagina o sezione dedicata al profilo utente', async ({ page }) => {
    // Controlla /profile, /settings/profile, /onboarding, /setup/profile
    const profilePaths = ['/profile', '/settings/profile', '/settings', '/onboarding'];
    let found = false;

    for (const path of profilePaths) {
      const res = await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
      if (res?.status() === 200) {
        const body = await page.locator('body').innerText();
        if (/profilo|profile|nome|name|professione|job title/i.test(body)) {
          found = true;
          break;
        }
      }
    }
    expect(found, 'Nessuna pagina profilo trovata in /profile, /settings/profile, /settings, /onboarding').toBe(true);
  });

  test('form profilo ha campo nome/cognome', async ({ page }) => {
    await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle' }).catch(() =>
      page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' })
    );

    const nameInput = page.locator(
      'input[name*="name" i], input[name*="nome" i], ' +
      'input[placeholder*="nome" i], input[placeholder*="name" i], ' +
      'input[id*="name" i], input[id*="nome" i]'
    ).first();
    await expect(nameInput).toBeVisible({ timeout: 10000 });
  });

  test('form profilo ha campo professione / job title', async ({ page }) => {
    await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle' }).catch(() =>
      page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' })
    );

    const jobInput = page.locator(
      'input[name*="job" i], input[name*="professione" i], input[name*="role" i], ' +
      'input[placeholder*="professione" i], input[placeholder*="job" i], ' +
      'input[placeholder*="ruolo" i], input[placeholder*="posizione" i], ' +
      'textarea[placeholder*="professione" i], select[name*="job" i]'
    ).first();
    await expect(jobInput).toBeVisible({ timeout: 10000 });
  });

  test('form profilo ha campo città / location', async ({ page }) => {
    await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle' }).catch(() =>
      page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' })
    );

    const locationInput = page.locator(
      'input[name*="city" i], input[name*="città" i], input[name*="location" i], ' +
      'input[placeholder*="città" i], input[placeholder*="city" i], ' +
      'input[placeholder*="location" i], input[placeholder*="dove" i]'
    ).first();
    await expect(locationInput).toBeVisible({ timeout: 10000 });
  });

  test('form profilo ha campo CV / upload documento', async ({ page }) => {
    await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle' }).catch(() =>
      page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' })
    );

    const cvInput = page.locator(
      'input[type="file"], input[name*="cv" i], input[name*="resume" i], ' +
      'button:text-matches("carica|upload|cv|curriculum", "i"), ' +
      'a:text-matches("carica|upload cv", "i")'
    ).first();
    await expect(cvInput).toBeVisible({ timeout: 10000 });
  });

  test('form profilo ha campo preferenze di ricerca (tipo posizione / settore)', async ({ page }) => {
    await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle' }).catch(() =>
      page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' })
    );

    const prefInput = page.locator(
      'input[name*="target" i], input[name*="cerca" i], input[name*="search" i], ' +
      'input[placeholder*="posizione cercata" i], input[placeholder*="ruolo cercato" i], ' +
      'textarea[placeholder*="cerca" i], select[name*="sector" i], ' +
      'input[name*="sector" i]'
    ).first();
    await expect(prefInput).toBeVisible({ timeout: 10000 });
  });

  test('form profilo è salvabile — bottone salva presente', async ({ page }) => {
    await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle' }).catch(() =>
      page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' })
    );

    const saveBtn = page.locator(
      'button:text-matches("salva|save|aggiorna|update|conferma", "i"), ' +
      'input[type="submit"]'
    ).first();
    await expect(saveBtn).toBeVisible({ timeout: 10000 });
  });

  test('compilazione e salvataggio profilo Marco Bianchi', async ({ page }) => {
    await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle' }).catch(() =>
      page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' })
    );

    // Compila i campi con i dati di Marco Bianchi
    const nameInput = page.locator('input[name*="name" i], input[placeholder*="nome" i]').first();
    if (await nameInput.count() > 0) await nameInput.fill('Marco Bianchi');

    const jobInput = page.locator('input[placeholder*="professione" i], input[name*="job" i]').first();
    if (await jobInput.count() > 0) await jobInput.fill('Architetto');

    const cityInput = page.locator('input[placeholder*="città" i], input[name*="city" i]').first();
    if (await cityInput.count() > 0) await cityInput.fill('Milano');

    // Salva
    const saveBtn = page.locator('button:text-matches("salva|save", "i")').first();
    if (await saveBtn.count() > 0) {
      await saveBtn.click();
      await page.waitForTimeout(1500);
      // ATTESO: feedback positivo
      const success = page.getByText(/salvato|saved|aggiornato|successo|ok/i);
      await expect(success.first()).toBeVisible({ timeout: 8000 });
    }
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// BUG 3 — Pagina agenti: istruzioni chiare per avviare il team
// ─────────────────────────────────────────────────────────────────────────────
test.describe('BUG 3 — Pagina agenti: istruzioni avvio', () => {

  test('pagina /agents mostra stato agenti con feedback visivo chiaro', async ({ page }) => {
    await page.goto(`${BASE}/agents`, { waitUntil: 'networkidle' });

    // ATTESO: ogni agente mostra uno stato leggibile (non solo "OFFLINE")
    const statusEl = page.locator(
      '[class*="status"], [data-status], ' +
      'text=OFFLINE, text=ONLINE, text=RUNNING, text=STOPPED, ' +
      'text=Offline, text=Online, text=Avviato, text=Fermo'
    ).first();
    await expect(statusEl).toBeVisible({ timeout: 10000 });
  });

  test('pagina /agents mostra un messaggio o banner quando tutti gli agenti sono offline', async ({ page }) => {
    await page.goto(`${BASE}/agents`, { waitUntil: 'networkidle' });
    const body = await page.locator('body').innerText();

    // ATTESO: messaggio che spiega come avviare (non solo stato "OFFLINE" silenzioso)
    const hasGuidance = /avvia|start|come iniziare|come avviare|istruzioni|guida|scarica|install/i.test(body);
    expect(
      hasGuidance,
      'Nessun messaggio di guida per utenti con agenti offline'
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

  test('pagina /agents ha banner/callout con istruzioni per avviare il server locale', async ({ page }) => {
    await page.goto(`${BASE}/agents`, { waitUntil: 'networkidle' });

    // ATTESO: istruzione tipo "Avvia il server con ./start.sh" o "Scarica e installa prima"
    const instructions = page.locator(
      '[class*="banner"], [class*="callout"], [class*="alert"], [class*="notice"], ' +
      '[role="alert"], [role="status"], ' +
      'text=start.sh, text=./start, text=npm start, text=avvia il server'
    ).first();
    // Oppure testo descrittivo nella pagina
    const body = await page.locator('body').innerText();
    const hasInstructions = /start\.sh|npm\s+start|avvia\s+il\s+server|server\s+locale|installa.*prima/i.test(body)
      || (await instructions.count()) > 0;
    expect(hasInstructions, 'Nessuna istruzione su come avviare il server locale').toBe(true);
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
      'a:text-matches("come avviare|come iniziare|guida|docs|documentazione|readme", "i"), ' +
      'button:text-matches("come avviare|guida", "i"), ' +
      'h2:text-matches("come avviare|come iniziare|istruzioni", "i"), ' +
      'h3:text-matches("come avviare|come iniziare|istruzioni", "i")'
    ).first();
    await expect(howToLink).toBeVisible({ timeout: 10000 });
  });

});
