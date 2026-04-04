import { test, expect } from '@playwright/test';

/**
 * FLUSSO 25 — /demo — Tour interattivo prodotto
 *
 * Suite 1: Struttura pagina — caricamento, H1, nav, footer
 * Suite 2: Step pills — navigazione 6 step con click
 * Suite 3: Mockup contenuto — verifica contenuto di ogni step
 * Suite 4: CTA e navigazione verso /download
 */

const BASE = process.env.BASE_URL || 'https://jobhunterteam.ai';

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 — Struttura pagina
// ─────────────────────────────────────────────────────────────────────────────
test.describe('/demo — Struttura pagina', () => {

  test.beforeEach(async ({ page }) => {
    const res = await page.goto(`${BASE}/demo`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) test.skip(true, '/demo non disponibile');
  });

  test('risponde 200', async ({ page }) => {
    const res = await page.goto(`${BASE}/demo`, { waitUntil: 'networkidle' });
    expect(res?.status()).toBe(200);
  });

  test('H1 presente con testo non vuoto', async ({ page }) => {
    const h1 = page.locator('h1').first();
    await expect(h1).toBeVisible({ timeout: 5000 });
    const text = await h1.innerText();
    expect(text.trim().length).toBeGreaterThan(3);
  });

  test('<title> presente e non vuoto', async ({ page }) => {
    const title = await page.title();
    expect(title).toBeTruthy();
    expect(title.length).toBeGreaterThan(3);
  });

  test('LandingNav presente con link /download', async ({ page }) => {
    const navLink = page.locator('nav a[href="/download"]').first();
    await expect(navLink).toBeVisible({ timeout: 5000 });
  });

  test('badge "Tour Interattivo" o testo demo visibile', async ({ page }) => {
    // Il badge sopra l'H1 contiene testo di presentazione del tour
    const badge = page.getByText(/tour|demo|interattivo/i).first();
    await expect(badge).toBeVisible({ timeout: 5000 });
  });

  test('sottotitolo/descrizione visibile sotto H1', async ({ page }) => {
    // Il paragrafo descrittivo è visibile
    const h1 = page.locator('h1').first();
    await expect(h1).toBeVisible({ timeout: 5000 });
    // Verifica che ci sia testo dopo l'H1 (p o div)
    const body = await page.locator('main p').first().innerText().catch(() => '');
    expect(body.length).toBeGreaterThan(0);
  });

  test('footer nav con link ← Home e Download → visibili', async ({ page }) => {
    const homeLink = page.locator('a[href="/"]').last();
    const downloadLink = page.locator('a[href="/download"]').last();
    await expect(homeLink).toBeVisible({ timeout: 5000 });
    await expect(downloadLink).toBeVisible({ timeout: 5000 });
  });

  test('nessun errore JavaScript critico al caricamento', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => jsErrors.push(e.message));
    await page.goto(`${BASE}/demo`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    const critical = jsErrors.filter((e) => !/expected|warning|chunk|hydrat/i.test(e));
    expect(critical, `Errori JS: ${critical.join(', ')}`).toHaveLength(0);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2 — Step pills e navigazione
// ─────────────────────────────────────────────────────────────────────────────
test.describe('/demo — Step pills e navigazione', () => {

  test.beforeEach(async ({ page }) => {
    const res = await page.goto(`${BASE}/demo`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) test.skip(true, '/demo non disponibile');
  });

  test('6 pill step (01–06) visibili', async ({ page }) => {
    // Le 6 pill sono button con testo 01, 02, ..., 06
    for (const n of ['01', '02', '03', '04', '05', '06']) {
      const pill = page.getByRole('button', { name: n }).first();
      await expect(pill, `Pill step ${n} non visibile`).toBeVisible({ timeout: 5000 });
    }
  });

  test('step 01 è attivo al caricamento (stile verde)', async ({ page }) => {
    // La pill 01 è attiva: ha background green (#00e87a) o colore testo #000
    const pill01 = page.getByRole('button', { name: '01' }).first();
    await expect(pill01).toBeVisible({ timeout: 5000 });
    // Verifica che sia visivamente attivo controllando il colore
    const color = await pill01.evaluate((el) => window.getComputedStyle(el).color);
    // Quando attivo: color è #000 (testo su sfondo verde)
    expect(color).toMatch(/rgb\(0,\s*0,\s*0\)|rgb\(0, 0, 0\)/i);
  });

  test('click su pill 02 cambia lo step attivo', async ({ page }) => {
    const pill02 = page.getByRole('button', { name: '02' }).first();
    await pill02.click();
    await page.waitForTimeout(300); // attesa animazione fade-in
    // Il bottone "Precedente" appare (solo dallo step 2 in poi)
    const prevBtn = page.getByRole('button', { name: /precedente/i }).first();
    await expect(prevBtn).toBeVisible({ timeout: 3000 });
  });

  test('click su pill 03 → bottone Precedente visibile', async ({ page }) => {
    await page.getByRole('button', { name: '03' }).first().click();
    await page.waitForTimeout(300);
    const prevBtn = page.getByRole('button', { name: /precedente/i }).first();
    await expect(prevBtn).toBeVisible({ timeout: 3000 });
  });

  test('click Successivo dallo step 01 avanza allo step 02', async ({ page }) => {
    const nextBtn = page.getByRole('button', { name: /successivo/i }).first();
    await expect(nextBtn).toBeVisible({ timeout: 5000 });
    await nextBtn.click();
    await page.waitForTimeout(300);
    // Il bottone Precedente appare dopo l'avanzamento
    const prevBtn = page.getByRole('button', { name: /precedente/i }).first();
    await expect(prevBtn).toBeVisible({ timeout: 3000 });
  });

  test('click Precedente torna indietro', async ({ page }) => {
    // Vai a step 02
    await page.getByRole('button', { name: '02' }).first().click();
    await page.waitForTimeout(300);
    // Torna a step 01
    const prevBtn = page.getByRole('button', { name: /precedente/i }).first();
    await prevBtn.click();
    await page.waitForTimeout(300);
    // Il bottone Precedente non dovrebbe più essere visibile (siamo a step 01)
    const prevCount = await page.getByRole('button', { name: /precedente/i }).count();
    expect(prevCount, 'Precedente ancora visibile allo step 01').toBe(0);
  });

  test('griglia "Tutti i passaggi" mostra 6 card cliccabili', async ({ page }) => {
    // La sezione "Tutti i passaggi" ha 6 bottoni card
    const heading = page.getByText(/tutti i passaggi/i).first();
    await expect(heading).toBeVisible({ timeout: 5000 });
    // Conta tutti i bottoni delle card (escludendo le pill e i bottoni nav)
    // Le card sono button con testo che contiene i numeri 01-06
    let count = 0;
    for (const n of ['01', '02', '03', '04', '05', '06']) {
      const cards = page.getByRole('button', { name: new RegExp(n) });
      count += await cards.count();
    }
    // Ogni numero appare sia nella pill (top) che nella card (bottom) = almeno 12
    expect(count, 'Meno di 12 bottoni step (6 pill + 6 card)').toBeGreaterThanOrEqual(12);
  });

  test('click su card "Tutti i passaggi" cambia lo step', async ({ page }) => {
    // Trova la sezione "Tutti i passaggi"
    const heading = page.getByText(/tutti i passaggi/i).first();
    await expect(heading).toBeVisible({ timeout: 5000 });
    // Clicca la terza card (step 03) nella griglia
    const pill03 = page.getByRole('button', { name: '03' }).nth(1); // la seconda occorrenza è la card
    await pill03.click();
    await page.waitForTimeout(500);
    // L'heading dello step corrente deve cambiare
    const prevBtn = page.getByRole('button', { name: /precedente/i }).first();
    await expect(prevBtn).toBeVisible({ timeout: 3000 });
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3 — Contenuto mockup per step
// ─────────────────────────────────────────────────────────────────────────────
test.describe('/demo — Contenuto mockup step', () => {

  test.beforeEach(async ({ page }) => {
    const res = await page.goto(`${BASE}/demo`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) test.skip(true, '/demo non disponibile');
  });

  test('step 01: mockup terminale mostra comandi ./start.sh', async ({ page }) => {
    // Step 01 è attivo di default
    const terminalText = page.getByText('./start.sh').first();
    await expect(terminalText).toBeVisible({ timeout: 5000 });
  });

  test('step 01: mockup mostra "localhost:3000"', async ({ page }) => {
    const localhostText = page.getByText(/localhost:3000/i).first();
    await expect(localhostText).toBeVisible({ timeout: 5000 });
  });

  test('step 02: mockup profilo mostra campi Nome, Competenze', async ({ page }) => {
    await page.getByRole('button', { name: '02' }).first().click();
    await page.waitForTimeout(300);
    await expect(page.getByText('Nome').first()).toBeVisible({ timeout: 3000 });
    await expect(page.getByText('Competenze').first()).toBeVisible({ timeout: 3000 });
  });

  test('step 03: mockup team mostra agenti Scout, Analista', async ({ page }) => {
    await page.getByRole('button', { name: '03' }).first().click();
    await page.waitForTimeout(300);
    await expect(page.getByText('Scout').first()).toBeVisible({ timeout: 3000 });
    await expect(page.getByText('Analista').first()).toBeVisible({ timeout: 3000 });
  });

  test('step 04: mockup pipeline mostra "47 offerte trovate"', async ({ page }) => {
    await page.getByRole('button', { name: '04' }).first().click();
    await page.waitForTimeout(300);
    const pipelineText = page.getByText(/offerte trovate/i).first();
    await expect(pipelineText).toBeVisible({ timeout: 3000 });
  });

  test('step 05: mockup dashboard mostra score "94%" o "91%"', async ({ page }) => {
    await page.getByRole('button', { name: '05' }).first().click();
    await page.waitForTimeout(300);
    const scoreText = page.getByText(/94%|91%/i).first();
    await expect(scoreText).toBeVisible({ timeout: 3000 });
  });

  test('step 06: mockup approvazione mostra bottone "Approva"', async ({ page }) => {
    await page.getByRole('button', { name: '06' }).first().click();
    await page.waitForTimeout(300);
    const approvaBtn = page.getByText(/approva/i).first();
    await expect(approvaBtn).toBeVisible({ timeout: 3000 });
  });

  test('step 06: bottone Successivo sostituito da link CTA Download', async ({ page }) => {
    await page.getByRole('button', { name: '06' }).first().click();
    await page.waitForTimeout(300);
    // Sull'ultimo step il bottone "Successivo" non c'è — c'è la CTA /download
    const successivoCount = await page.getByRole('button', { name: /successivo/i }).count();
    expect(successivoCount, 'Successivo ancora visibile sull\'ultimo step').toBe(0);
    // Invece c'è un link verso /download
    const ctaLink = page.locator('a[href="/download"]').first();
    await expect(ctaLink).toBeVisible({ timeout: 3000 });
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4 — CTA e navigazione
// ─────────────────────────────────────────────────────────────────────────────
test.describe('/demo — CTA e navigazione', () => {

  test('CTA sull\'ultimo step naviga su /download', async ({ page }) => {
    const res = await page.goto(`${BASE}/demo`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) test.skip(true, '/demo non disponibile');

    // Vai all'ultimo step
    await page.getByRole('button', { name: '06' }).first().click();
    await page.waitForTimeout(300);

    // Clicca la CTA
    const ctaLink = page.locator('a[href="/download"]').first();
    await expect(ctaLink).toBeVisible({ timeout: 3000 });
    await ctaLink.click();
    await page.waitForURL(`${BASE}/download`, { timeout: 10000 });
    expect(page.url()).toContain('/download');
  });

  test('footer link ← Home naviga su /', async ({ page }) => {
    const res = await page.goto(`${BASE}/demo`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) test.skip(true, '/demo non disponibile');

    const homeLink = page.locator('a[href="/"]').last();
    await expect(homeLink).toBeVisible({ timeout: 5000 });
    await page.evaluate(() => {
      (document.querySelector('a[href="/"]') as HTMLAnchorElement)?.click();
    });
    await page.waitForURL((url) => !url.pathname.includes('/demo'), { timeout: 10000 });
    expect(page.url()).toMatch(/jobhunterteam\.ai\/?$/);
  });

  test('/demo accessibile dalla homepage (link presente)', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    // Cerca un link a /demo nella homepage (navbar o hero)
    const demoLink = page.locator('a[href="/demo"]').first();
    const count = await demoLink.count();
    if (count === 0) test.skip(true, 'Link /demo non ancora presente sulla homepage');
    await expect(demoLink).toBeVisible({ timeout: 3000 });
  });

  test('/demo: nessun overflow orizzontale su mobile (375px)', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await context.newPage();
    const res = await page.goto(`${BASE}/demo`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) {
      await context.close();
      test.skip(true, '/demo non disponibile');
    }
    const overflow = await page.evaluate(() => document.body.scrollWidth > window.innerWidth);
    await context.close();
    expect(overflow, 'Overflow orizzontale su /demo mobile').toBe(false);
  });

  test('/demo: 6 pill visibili su mobile (375px)', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await context.newPage();
    const res = await page.goto(`${BASE}/demo`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) {
      await context.close();
      test.skip(true, '/demo non disponibile');
    }
    let visible = 0;
    for (const n of ['01', '02', '03', '04', '05', '06']) {
      const pill = page.getByRole('button', { name: n }).first();
      if (await pill.isVisible({ timeout: 3000 }).catch(() => false)) visible++;
    }
    await context.close();
    expect(visible, 'Meno di 6 pill visibili su mobile').toBe(6);
  });

});
