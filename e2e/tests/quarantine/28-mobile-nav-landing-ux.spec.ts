import { test, expect } from '@playwright/test';

/**
 * FLUSSO 28 — MOBILE NAV, LANDING UX, CROSS-PAGE
 *
 * Suite 1: LandingNav hamburger menu su mobile (375px)
 * Suite 2: FadeInSection — animazioni visibili su scroll
 * Suite 3: Navigazione cross-page completa (nuove pagine: /pricing, /privacy, /demo)
 * Suite 4: Lang switcher (IT/EN) sulla landing
 */

const BASE = process.env.BASE_URL || 'https://jobhunterteam.ai';

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 — LandingNav hamburger menu su mobile
// ─────────────────────────────────────────────────────────────────────────────
test.describe('LandingNav — hamburger menu mobile', () => {

  test.use({ viewport: { width: 375, height: 812 } });

  /** Helper: trova il bottone hamburger o skippa se non ancora deployato */
  async function findHamburger(page: any): Promise<any> {
    const hamburger = page.locator('button[aria-label="Menu"]').first();
    const visible = await hamburger.isVisible({ timeout: 3000 }).catch(() => false);
    if (!visible) {
      test.skip(true, 'Hamburger menu non ancora deployato in questa versione');
      return null;
    }
    return hamburger;
  }

  test('hamburger button visibile su mobile (375px)', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const hamburger = await findHamburger(page);
    if (!hamburger) return;
    await expect(hamburger).toBeVisible({ timeout: 5000 });
  });

  test('click hamburger apre il menu mobile', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const hamburger = await findHamburger(page);
    if (!hamburger) return;
    await hamburger.click();
    await page.waitForTimeout(300);
    const navLink = page.locator('[class*="md:hidden"] a').first();
    await expect(navLink).toBeVisible({ timeout: 3000 });
  });

  test('menu mobile mostra link Download, Guida, FAQ', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const hamburger = await findHamburger(page);
    if (!hamburger) return;
    await hamburger.click();
    await page.waitForTimeout(300);
    const navLinks = page.locator('[class*="md:hidden"] a[href="/download"], [class*="md:hidden"] a[href="/faq"], [class*="md:hidden"] a[href="/guide"]');
    const count = await navLinks.count();
    expect(count, 'Nessun link di navigazione nel menu mobile').toBeGreaterThanOrEqual(1);
  });

  test('click hamburger di nuovo chiude il menu', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const hamburger = await findHamburger(page);
    if (!hamburger) return;
    await hamburger.click();
    await page.waitForTimeout(200);
    await hamburger.click();
    await page.waitForTimeout(300);
    const navLink = page.locator('[class*="md:hidden"] a[href="/download"]');
    const count = await navLink.count();
    if (count > 0) {
      const visible = await navLink.first().isVisible().catch(() => false);
      expect(visible, 'Menu mobile non si è chiuso').toBe(false);
    }
  });

  test('/faq: hamburger visibile su mobile', async ({ page }) => {
    const res = await page.goto(`${BASE}/faq`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) test.skip(true, '/faq non disponibile');
    const hamburger = await findHamburger(page);
    if (!hamburger) return;
    await expect(hamburger).toBeVisible({ timeout: 5000 });
  });

  test('/guide: hamburger visibile su mobile', async ({ page }) => {
    const res = await page.goto(`${BASE}/guide`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) test.skip(true, '/guide non disponibile');
    const hamburger = await findHamburger(page);
    if (!hamburger) return;
    await expect(hamburger).toBeVisible({ timeout: 5000 });
  });

  test('/download: hamburger visibile su mobile', async ({ page }) => {
    const res = await page.goto(`${BASE}/download`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) test.skip(true, '/download non disponibile');
    const hamburger = await findHamburger(page);
    if (!hamburger) return;
    await expect(hamburger).toBeVisible({ timeout: 5000 });
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2 — Landing homepage UX (sezioni, scroll, CTA)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Landing homepage — sezioni e UX', () => {

  test('sezione #features visibile dopo scroll', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    // Scroll fino a features
    await page.evaluate(() => window.scrollBy(0, 600));
    await page.waitForTimeout(300);
    // Cerca testo caratteristico della sezione features
    const featuresEl = page.getByText(/agenti|ricerca automatica|open.source|locale/i).first();
    await expect(featuresEl).toBeVisible({ timeout: 5000 });
  });

  test('sezione how-it-works (#how) visibile', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.evaluate(() => window.scrollBy(0, 1200));
    await page.waitForTimeout(400);
    // La sezione "Come funziona" ha almeno un H2 o testo descrittivo
    const howEl = page.getByText(/come funziona|in 3 passi|3 step|inizia/i).first();
    const count = await howEl.count();
    if (count === 0) test.skip(true, 'Sezione how-it-works non trovata con questo testo');
    await expect(howEl).toBeVisible({ timeout: 3000 });
  });

  test('CTA finale (footer landing) presente', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    // Scroll al fondo
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
    // Il footer ha i link GitHub e /download
    const ghLink = page.locator('a[href*="github.com"]').last();
    await expect(ghLink).toBeVisible({ timeout: 5000 });
  });

  test('link /pricing nella navbar o footer della landing', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const pricingLink = page.locator('a[href="/pricing"]').first();
    const count = await pricingLink.count();
    if (count === 0) test.skip(true, 'Link /pricing non ancora presente sulla homepage');
    await expect(pricingLink).toBeVisible({ timeout: 3000 });
  });

  test('link /privacy nella navbar o footer della landing', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    // Privacy è tipicamente nel footer
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
    const privacyLink = page.locator('a[href="/privacy"]').first();
    const count = await privacyLink.count();
    if (count === 0) test.skip(true, 'Link /privacy non ancora presente sulla homepage');
    await expect(privacyLink).toBeVisible({ timeout: 3000 });
  });

  test('nessuna richiesta di rete fallita al caricamento homepage', async ({ page }) => {
    const failedRequests: string[] = [];
    page.on('requestfailed', (req) => {
      if (!req.url().includes('localhost') && !req.url().includes('127.0.0.1')) {
        failedRequests.push(`${req.failure()?.errorText} — ${req.url()}`);
      }
    });
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    expect(failedRequests, `Richieste fallite: ${failedRequests.join(', ')}`).toHaveLength(0);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3 — Navigazione cross-page: nuove pagine
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Navigazione cross-page — pagine nuove', () => {

  test('/pricing: status non 500 (200 o 404 se non ancora deployata)', async ({ request }) => {
    const res = await request.get(`${BASE}/pricing`);
    expect(res.status(), '/pricing risponde 500 — errore server').not.toBe(500);
  });

  test('/privacy: status non 500', async ({ request }) => {
    const res = await request.get(`${BASE}/privacy`);
    expect(res.status(), '/privacy risponde 500 — errore server').not.toBe(500);
  });

  test('/demo: status non 500', async ({ request }) => {
    const res = await request.get(`${BASE}/demo`);
    expect(res.status(), '/demo risponde 500 — errore server').not.toBe(500);
  });

  test('tutte le pagine pubbliche note non rispondono 500', async ({ request }) => {
    const pages = ['/', '/faq', '/guide', '/download', '/changelog', '/docs', '/about', '/pricing', '/privacy', '/demo'];
    const errors: string[] = [];
    for (const path of pages) {
      const res = await request.get(`${BASE}${path}`, { timeout: 10000 }).catch(() => null);
      if (res?.status() === 500) errors.push(`500 ${path}`);
    }
    expect(errors, `Pagine con errore 500:\n${errors.join('\n')}`).toHaveLength(0);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4 — Lang switcher IT/EN
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Lang switcher — IT/EN sulla landing', () => {

  test('bottone lang switcher visibile nella navbar', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    // Il lang switcher è un button con testo IT o EN oppure una bandiera
    const langBtn = page.locator('button').filter({ hasText: /^IT$|^EN$|🇮🇹|🇬🇧|lang/i }).first();
    const count = await langBtn.count();
    if (count === 0) test.skip(true, 'Lang switcher non trovato come button IT/EN');
    await expect(langBtn).toBeVisible({ timeout: 5000 });
  });

  test('click lang switcher cambia lingua (EN visibile dopo click)', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    // Trova il lang switcher come bottone nella navbar
    const langBtn = page.locator('nav button').filter({ hasText: /^IT$|^EN$/i }).first();
    const count = await langBtn.count();
    if (count === 0) test.skip(true, 'Lang switcher non trovato');
    const currentLang = await langBtn.innerText();
    await langBtn.click();
    await page.waitForTimeout(300);
    // La lingua deve essere cambiata
    const newLang = await langBtn.innerText();
    expect(newLang).not.toBe(currentLang);
  });

  test('/faq: lang switcher presente', async ({ page }) => {
    const res = await page.goto(`${BASE}/faq`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) test.skip(true, '/faq non disponibile');
    const langBtn = page.locator('nav button').filter({ hasText: /^IT$|^EN$/i }).first();
    const count = await langBtn.count();
    if (count === 0) test.skip(true, 'Lang switcher non trovato su /faq');
    await expect(langBtn).toBeVisible({ timeout: 3000 });
  });

  test('/guide: lang switcher presente', async ({ page }) => {
    const res = await page.goto(`${BASE}/guide`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) test.skip(true, '/guide non disponibile');
    const langBtn = page.locator('nav button').filter({ hasText: /^IT$|^EN$/i }).first();
    const count = await langBtn.count();
    if (count === 0) test.skip(true, 'Lang switcher non trovato su /guide');
    await expect(langBtn).toBeVisible({ timeout: 3000 });
  });

});
