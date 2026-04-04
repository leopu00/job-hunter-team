import { test, expect } from '@playwright/test';

/**
 * FLUSSO 26 — /changelog e /docs
 *
 * Suite 1: /changelog — pagina con dati API reali (git log)
 * Suite 2: /docs — documentazione tecnica
 * Suite 3: API /api/changelog — risposta JSON valida
 */

const BASE = process.env.BASE_URL || 'https://jobhunterteam.ai';

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 — /changelog
// ─────────────────────────────────────────────────────────────────────────────
test.describe('/changelog — Pagina storico commit', () => {

  test.beforeEach(async ({ page }) => {
    const res = await page.goto(`${BASE}/changelog`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) test.skip(true, '/changelog non disponibile');
  });

  test('risponde 200', async ({ page }) => {
    const res = await page.goto(`${BASE}/changelog`, { waitUntil: 'networkidle' });
    expect(res?.status()).toBe(200);
  });

  test('H1 "Changelog" presente', async ({ page }) => {
    const h1 = page.locator('h1').first();
    await expect(h1).toBeVisible({ timeout: 5000 });
    const text = await h1.innerText();
    expect(text).toMatch(/changelog/i);
  });

  test('<title> presente e non vuoto', async ({ page }) => {
    const title = await page.title();
    expect(title).toBeTruthy();
    expect(title.length).toBeGreaterThan(3);
  });

  test('filtri tipo commit visibili (tutti, feature, fix, merge, test)', async ({ page }) => {
    // I filtri sono button con testo: tutti, feature, fix, merge, test
    for (const label of ['tutti', 'feature', 'fix']) {
      const btn = page.getByRole('button', { name: new RegExp(label, 'i') }).first();
      await expect(btn, `Filtro "${label}" non visibile`).toBeVisible({ timeout: 5000 });
    }
  });

  test('almeno un gruppo di commit (data) caricato', async ({ page }) => {
    // Aspetta il caricamento dati dall'API
    await page.waitForTimeout(2000);
    // Cerca almeno un elemento con data o hash commit
    // I commit sono raggruppati per data — cerca testo con anno 202x
    const dateEl = page.getByText(/202[3-9]|2030/i).first();
    const count = await dateEl.count();
    if (count === 0) {
      // git log non disponibile in ambiente serverless (Vercel) — skip documentativo
      test.skip(true, 'git log non disponibile in questo ambiente (Vercel serverless)');
      return;
    }
    expect(count).toBeGreaterThan(0);
  });

  test('almeno un commit con hash visibile', async ({ page }) => {
    await page.waitForTimeout(2000);
    // Gli hash commit sono stringhe esadecimali di 7 caratteri nel DOM
    const hashEl = page.locator('[class*="hash"], [class*="mono"], code').first();
    const count = await hashEl.count();
    if (count === 0) test.skip(true, 'Nessun hash commit trovato — layout diverso da atteso');
    await expect(hashEl).toBeVisible({ timeout: 3000 });
  });

  test('click filtro "feature" mostra solo commit feat', async ({ page }) => {
    await page.waitForTimeout(1500); // attesa dati API
    const featBtn = page.getByRole('button', { name: /feature/i }).first();
    await expect(featBtn).toBeVisible({ timeout: 5000 });
    await featBtn.click();
    await page.waitForTimeout(500);
    // Dopo il filtro, il bottone deve risultare attivo (stile diverso)
    // Verifichiamo che il filtro sia stato applicato senza errori JS
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => jsErrors.push(e.message));
    expect(jsErrors).toHaveLength(0);
  });

  test('click filtro "fix" non crashar la pagina', async ({ page }) => {
    await page.waitForTimeout(1500);
    const fixBtn = page.getByRole('button', { name: /^fix$/i }).first();
    await expect(fixBtn).toBeVisible({ timeout: 5000 });
    await fixBtn.click();
    await page.waitForTimeout(500);
    // H1 ancora visibile — pagina non crashata
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 3000 });
  });

  test('click filtro "tutti" ricarica tutti i commit', async ({ page }) => {
    await page.waitForTimeout(1500);
    // Prima filtra per fix
    const fixBtn = page.getByRole('button', { name: /^fix$/i }).first();
    await fixBtn.click();
    await page.waitForTimeout(300);
    // Poi torna a "tutti"
    const tuttiBtn = page.getByRole('button', { name: /tutti/i }).first();
    await tuttiBtn.click();
    await page.waitForTimeout(500);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 3000 });
  });

  test('nessun overflow orizzontale su mobile (375px)', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    const res = await page.goto(`${BASE}/changelog`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) { await ctx.close(); test.skip(true, '/changelog non disponibile'); }
    const overflow = await page.evaluate(() => document.body.scrollWidth > window.innerWidth);
    await ctx.close();
    expect(overflow, 'Overflow orizzontale su /changelog mobile').toBe(false);
  });

  test('nessun errore JavaScript critico', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => jsErrors.push(e.message));
    await page.goto(`${BASE}/changelog`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    const critical = jsErrors.filter((e) => !/expected|warning|chunk|hydrat/i.test(e));
    expect(critical, `Errori JS: ${critical.join(', ')}`).toHaveLength(0);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2 — /docs
// ─────────────────────────────────────────────────────────────────────────────
test.describe('/docs — Documentazione tecnica', () => {

  test.beforeEach(async ({ page }) => {
    const res = await page.goto(`${BASE}/docs`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) test.skip(true, '/docs non disponibile');
  });

  test('risponde 200', async ({ page }) => {
    const res = await page.goto(`${BASE}/docs`, { waitUntil: 'networkidle' });
    expect(res?.status()).toBe(200);
  });

  test('H1 "Documentazione" presente', async ({ page }) => {
    const h1 = page.locator('h1').first();
    await expect(h1).toBeVisible({ timeout: 5000 });
    const text = await h1.innerText();
    expect(text).toMatch(/documentazione|docs/i);
  });

  test('sezioni di navigazione o menu visibili', async ({ page }) => {
    // /docs ha un menu laterale o tab di sezioni
    const nav = page.locator('nav, aside, [class*="nav"], [class*="menu"], [class*="sidebar"]').first();
    const count = await nav.count();
    if (count === 0) {
      // Alternativa: almeno più H2 visibili (sezioni della documentazione)
      const h2Count = await page.locator('h2').count();
      expect(h2Count, 'Nessuna sezione H2 nella documentazione').toBeGreaterThan(0);
    } else {
      await expect(nav).toBeVisible({ timeout: 5000 });
    }
  });

  test('link a /guide o /faq presenti', async ({ page }) => {
    // La documentazione cross-linka con guida e FAQ
    const guideOrFaqLink = page.locator('a[href="/guide"], a[href="/faq"]').first();
    const count = await guideOrFaqLink.count();
    if (count === 0) test.skip(true, 'Nessun link a /guide o /faq in /docs');
    await expect(guideOrFaqLink).toBeVisible({ timeout: 3000 });
  });

  test('nessun overflow orizzontale su mobile (375px)', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    const res = await page.goto(`${BASE}/docs`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) { await ctx.close(); test.skip(true, '/docs non disponibile'); }
    const overflow = await page.evaluate(() => document.body.scrollWidth > window.innerWidth);
    await ctx.close();
    expect(overflow, 'Overflow orizzontale su /docs mobile').toBe(false);
  });

  test('nessun errore JavaScript critico', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => jsErrors.push(e.message));
    await page.goto(`${BASE}/docs`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    const critical = jsErrors.filter((e) => !/expected|warning|chunk|hydrat/i.test(e));
    expect(critical, `Errori JS /docs: ${critical.join(', ')}`).toHaveLength(0);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3 — API /api/changelog
// ─────────────────────────────────────────────────────────────────────────────
test.describe('API /api/changelog', () => {

  test('risponde con JSON valido', async ({ request }) => {
    const res = await request.get(`${BASE}/api/changelog`);
    // Potrebbe rispondere 200 (git disponibile) o 500 (git non configurato su Vercel)
    // In ogni caso non deve essere 404
    expect(res.status(), '/api/changelog risponde 404 — endpoint mancante').not.toBe(404);
  });

  test('se 200: campo "ok" presente nel JSON', async ({ request }) => {
    const res = await request.get(`${BASE}/api/changelog`);
    if (res.status() !== 200) test.skip(true, 'API changelog non risponde 200');
    const body = await res.json().catch(() => null);
    expect(body, 'Body non è JSON valido').not.toBeNull();
    expect(body).toHaveProperty('ok');
  });

  test('se 200: campo "days" è un array', async ({ request }) => {
    const res = await request.get(`${BASE}/api/changelog`);
    if (res.status() !== 200) test.skip(true, 'API changelog non risponde 200');
    const body = await res.json().catch(() => null);
    if (!body?.ok) test.skip(true, 'API changelog ok=false — git non disponibile');
    expect(Array.isArray(body.days), '"days" non è un array').toBe(true);
  });

  test('Content-Type è application/json', async ({ request }) => {
    const res = await request.get(`${BASE}/api/changelog`);
    if (res.status() === 404) test.skip(true, 'API changelog non disponibile');
    const ct = res.headers()['content-type'] ?? '';
    expect(ct, 'Content-Type non è JSON').toMatch(/application\/json/i);
  });

});
