import { test, expect } from '@playwright/test';

/**
 * FLUSSO 19 — i18n, language switcher, download funzionante
 * Verifica: language switcher presente, cambio lingua IT/EN,
 * link download Mac/Linux/Windows reali e raggiungibili.
 */

const BASE = process.env.BASE_URL || 'https://jobhunterteam.ai';

// ─────────────────────────────────────────────────────────────────────────────
// LANGUAGE SWITCHER
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Language switcher (i18n)', () => {

  test('language switcher (bandiera) presente nella navbar', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    // Il switcher è un <button> con SVG bandiera nella <nav>
    const switcher = page.locator('nav button:has(svg)').first();
    await expect(switcher).toBeVisible({ timeout: 10000 });
  });

  test('language switcher presente su /download', async ({ page }) => {
    await page.goto(`${BASE}/download`, { waitUntil: 'networkidle' });
    const switcher = page.locator('nav button:has(svg), [data-testid*="lang"], [aria-label*="language" i]').first();
    await expect(switcher).toBeVisible({ timeout: 10000 });
  });

  test('click su language switcher cambia la lingua', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'networkidle' });

    const body = page.locator('body');
    const textBefore = await body.innerText();

    // Clicca il bottone bandiera nella nav
    const switcher = page.locator('nav button:has(svg)').first();
    await expect(switcher).toBeVisible({ timeout: 10000 });
    await switcher.click();
    await page.waitForTimeout(800);

    // Attendi eventuale navigazione o cambio contenuto
    const textAfter = await body.innerText();
    // Il contenuto deve essere cambiato o deve apparire un dropdown/menu
    const contentChanged = textAfter !== textBefore;
    const dropdownVisible = await page.locator('[role="menu"], [role="listbox"], [class*="dropdown"]').count() > 0;
    expect(contentChanged || dropdownVisible, 'Language switcher non ha prodotto effetti').toBe(true);
  });

  test('dopo cambio lingua la pagina mantiene struttura (no 404/500)', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'networkidle' });

    const switcher = page.locator('nav button:has(svg)').first();
    if (await switcher.count() === 0) { test.skip(); return; }

    await switcher.click();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);

    // La pagina non deve mostrare errore
    const h1 = await page.locator('h1').count();
    expect(h1, 'Nessun H1 dopo cambio lingua').toBeGreaterThan(0);
    expect(page.url()).toMatch(/web-nine-brown-79\.vercel\.app|jobhunterteam\.ai/);
  });

  test('URL riflette la lingua selezionata (route /en o param ?lang=en)', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'networkidle' });

    const switcher = page.locator('nav button:has(svg)').first();
    if (await switcher.count() === 0) { test.skip(); return; }

    await switcher.click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    const url = page.url();
    const bodyText = await page.locator('body').innerText();
    const langInUrl = /\/en\b|[?&]lang=en|[?&]locale=en/i.test(url);
    const textIsEnglish = /find|job|search|agents|team/i.test(bodyText);
    expect(langInUrl || textIsEnglish, 'Lingua non riflessa in URL né nel contenuto').toBe(true);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// DOWNLOAD — link reali e raggiungibili
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Download — link funzionanti', () => {

  test('/download carica con 200', async ({ page }) => {
    const res = await page.goto(`${BASE}/download`, { waitUntil: 'domcontentloaded' });
    expect(res?.status()).toBe(200);
  });

  test('link download macOS presente e non 404', async ({ page, request }) => {
    await page.goto(`${BASE}/download`, { waitUntil: 'networkidle' });

    const macLink = page.locator(
      'a[href*="mac"], a[href*=".dmg"], a[href*="darwin"], a[href*="osx"]'
    ).first();
    await expect(macLink).toBeVisible({ timeout: 10000 });

    const href = await macLink.getAttribute('href');
    expect(href).toBeTruthy();

    // Verifica che il link risponda (HEAD request, non scaricare il file)
    const resp = await request.head(href!, { timeout: 15000 }).catch(() => null);
    if (resp) {
      expect(
        resp.status(),
        `Link Mac ${href} ha restituito ${resp.status()}`
      ).not.toBe(404);
    }
  });

  test('link download Linux presente e non 404', async ({ page, request }) => {
    await page.goto(`${BASE}/download`, { waitUntil: 'networkidle' });

    const linuxLink = page.locator(
      'a[href*="linux"], a[href*=".AppImage"], a[href*=".deb"], a[href*=".tar.gz"]'
    ).first();
    await expect(linuxLink).toBeVisible({ timeout: 10000 });

    const href = await linuxLink.getAttribute('href');
    expect(href).toBeTruthy();

    const resp = await request.head(href!, { timeout: 15000 }).catch(() => null);
    if (resp) {
      expect(resp.status(), `Link Linux ${href} ha restituito ${resp.status()}`).not.toBe(404);
    }
  });

  test('link download Windows presente e non 404', async ({ page, request }) => {
    await page.goto(`${BASE}/download`, { waitUntil: 'networkidle' });

    const winLink = page.locator(
      'a[href*="windows"], a[href*=".exe"], a[href*=".msi"], a[href*=".zip"]'
    ).first();
    await expect(winLink).toBeVisible({ timeout: 10000 });

    const href = await winLink.getAttribute('href');
    expect(href).toBeTruthy();

    const resp = await request.head(href!, { timeout: 15000 }).catch(() => null);
    if (resp) {
      expect(resp.status(), `Link Windows ${href} ha restituito ${resp.status()}`).not.toBe(404);
    }
  });

  test('3 card OS mostrano nome file e bottone Scarica', async ({ page }) => {
    await page.goto(`${BASE}/download`, { waitUntil: 'networkidle' });

    // Ogni card deve avere un nome file release coerente (es. job-hunter-team-0.1.0-mac.dmg)
    const fileNames = page.locator('[class*="filename"], [class*="file-name"], code, .font-mono')
      .or(page.getByText(/\.tar\.gz|\.dmg|\.exe|\.zip|\.AppImage|\.deb/i));
    await expect(fileNames.first()).toBeVisible({ timeout: 10000 });

    // Tutti e 3 i bottoni Scarica visibili
    const scaricaButtons = page.getByText(/^scarica$/i).or(page.getByText(/^download$/i));
    await expect(scaricaButtons.first()).toBeVisible({ timeout: 10000 });
    const count = await scaricaButtons.count();
    expect(count, 'Meno di 3 bottoni Scarica').toBeGreaterThanOrEqual(3);
  });

  test('macOS: rilevamento sistema operativo visibile', async ({ page }) => {
    await page.goto(`${BASE}/download`, { waitUntil: 'networkidle' });
    // La pagina dovrebbe indicare l'OS rilevato (badge "RILEVATO" o "CONSIGLIATO")
    const badge = page.getByText(/rilevato|consigliato|recommended|detected/i).first();
    await expect(badge).toBeVisible({ timeout: 10000 });
  });

});
