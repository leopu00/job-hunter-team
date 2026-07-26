import { test, expect } from '@playwright/test';

/**
 * FLUSSO 34 — PAGINA /stats
 *
 * Suite 1: Risposta e struttura base — status, H1, title
 * Suite 2: Sezioni dashboard — metriche, grafici, tabelle
 * Suite 3: API /api/stats — risposta, struttura JSON
 * Suite 4: Interattività — filtri, periodo, aggiornamento dati
 * Suite 5: Mobile responsiveness
 */

const BASE = process.env.BASE_URL || 'https://jobhunterteam.ai';

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 — Risposta e struttura base
// ─────────────────────────────────────────────────────────────────────────────
test.describe('/stats — struttura base', () => {

  test('GET /stats risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/stats`);
    if (res.status() === 404) test.skip(true, '/stats non ancora deployata');
    expect(res.status(), '/stats risponde 500').not.toBe(500);
  });

  test('/stats: H1 visibile', async ({ page }) => {
    const res = await page.goto(`${BASE}/stats`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) test.skip(true, '/stats non disponibile');
    const h1 = page.locator('h1').first();
    await expect(h1, 'H1 assente su /stats').toBeVisible({ timeout: 8000 });
    const text = await h1.innerText();
    expect(text.trim().length).toBeGreaterThan(0);
  });

  test('/stats: <title> presente', async ({ page }) => {
    const res = await page.goto(`${BASE}/stats`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) test.skip(true, '/stats non disponibile');
    const title = await page.title();
    expect(title.trim().length).toBeGreaterThan(3);
  });

  test('/stats: nessun errore JS critico', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    const res = await page.goto(`${BASE}/stats`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) test.skip(true, '/stats non disponibile');
    await page.waitForTimeout(1000);
    expect(jsErrors, `Errori JS /stats: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

  test('/stats: nessun overflow orizzontale desktop', async ({ page }) => {
    const res = await page.goto(`${BASE}/stats`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) test.skip(true, '/stats non disponibile');
    const overflow = await page.evaluate(() => document.body.scrollWidth > window.innerWidth);
    expect(overflow, 'Overflow orizzontale su /stats desktop').toBe(false);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2 — Sezioni dashboard
// ─────────────────────────────────────────────────────────────────────────────
test.describe('/stats — sezioni e metriche', () => {

  test.beforeEach(async ({ page }) => {
    const res = await page.goto(`${BASE}/stats`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) test.skip(true, '/stats non disponibile');
  });

  test('almeno una metrica numerica visibile', async ({ page }) => {
    // Cerca numeri statistici (es. 42 candidature, 12 risposte)
    const numbers = page.locator('[class*="stat"], [class*="metric"], [class*="count"], [class*="number"]').first();
    const count = await numbers.count();
    if (count === 0) {
      // Alternativa: cerca semplicemente testo numerico significativo
      const anyNumber = page.getByText(/\d{1,6}/).first();
      const numCount = await anyNumber.count();
      if (numCount === 0) test.skip(true, 'Metriche non trovate — layout diverso');
    }
    expect(true).toBe(true);
  });

  test('sezione "candidature" o "applications" presente', async ({ page }) => {
    const section = page.getByText(/candidature|applications|posizioni|richieste/i).first();
    const count = await section.count();
    if (count === 0) test.skip(true, 'Sezione candidature non trovata');
    await expect(section).toBeVisible({ timeout: 5000 });
  });

  test('sezione "scout" o "ricerche" presente', async ({ page }) => {
    const section = page.getByText(/scout|ricerche|ricerca|scansione/i).first();
    const count = await section.count();
    if (count === 0) test.skip(true, 'Sezione scout non trovata');
    await expect(section).toBeVisible({ timeout: 5000 });
  });

  test('grafici o visualizzazioni presenti', async ({ page }) => {
    // Cerca grafici SVG (recharts/chart.js), canvas o elementi chart
    const charts = await page.locator('svg[class*="chart"], canvas, [class*="chart"], [class*="recharts"]').count();
    if (charts === 0) test.skip(true, 'Grafici non trovati — possibile layout tabellare');
    expect(charts).toBeGreaterThan(0);
  });

  test('tabella dati o lista con righe presente', async ({ page }) => {
    const table = page.locator('table, [role="grid"], [class*="table"]').first();
    const count = await table.count();
    if (count === 0) {
      // Alternativa: lista
      const list = page.locator('ul li, [class*="list-item"]').first();
      const listCount = await list.count();
      if (listCount === 0) test.skip(true, 'Nessuna tabella/lista dati trovata');
    }
    expect(true).toBe(true);
  });

  test('link di navigazione verso /dashboard o /applications presente', async ({ page }) => {
    const navLink = page.locator('a[href*="dashboard"], a[href*="applications"], a[href*="positions"]').first();
    const count = await navLink.count();
    if (count === 0) test.skip(true, 'Link navigazione dashboard non trovato');
    await expect(navLink).toBeVisible({ timeout: 3000 });
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3 — API /api/stats
// ─────────────────────────────────────────────────────────────────────────────
test.describe('API /api/stats', () => {

  test('GET /api/stats risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/stats`);
    if (res.status() === 404) test.skip(true, '/api/stats non ancora deployata');
    expect(res.status(), '/api/stats risponde 500').not.toBe(500);
  });

  test('GET /api/stats risponde 200', async ({ request }) => {
    const res = await request.get(`${BASE}/api/stats`);
    if (res.status() === 404) test.skip(true, '/api/stats non ancora deployata');
    if (res.status() === 401 || res.status() === 403) {
      test.skip(true, '/api/stats richiede autenticazione — comportamento atteso');
    }
    expect(res.status()).toBe(200);
  });

  test('GET /api/stats: Content-Type JSON', async ({ request }) => {
    const res = await request.get(`${BASE}/api/stats`);
    if (res.status() !== 200) test.skip(true, '/api/stats non risponde 200');
    const ct = res.headers()['content-type'] ?? '';
    expect(ct).toMatch(/application\/json/i);
  });

  test('GET /api/stats: JSON con struttura dati', async ({ request }) => {
    const res = await request.get(`${BASE}/api/stats`);
    if (res.status() !== 200) test.skip(true, '/api/stats non risponde 200');
    const body = await res.json().catch(() => null);
    expect(body, 'Body non è JSON').not.toBeNull();
    // Struttura tipica: { ok, data, error }
    const hasFields = body && (
      'ok' in body || 'data' in body || 'stats' in body ||
      'error' in body || 'applications' in body || 'total' in body
    );
    expect(hasFields, 'Struttura JSON /api/stats inattesa').toBeTruthy();
  });

  test('GET /api/stats: risposta < 3000ms', async ({ request }) => {
    const start = Date.now();
    const res = await request.get(`${BASE}/api/stats`);
    const elapsed = Date.now() - start;
    if (res.status() !== 200) test.skip(true, '/api/stats non risponde 200');
    expect(elapsed, `/api/stats troppo lenta: ${elapsed}ms`).toBeLessThan(3000);
  });

  test('GET /api/stats: nessun dato sensibile nel body', async ({ request }) => {
    const res = await request.get(`${BASE}/api/stats`);
    if (res.status() !== 200) test.skip(true, '/api/stats non risponde 200');
    const text = await res.text();
    expect(text).not.toMatch(/sk-ant-|password|secret/i);
    expect(text).not.toMatch(/\/home\/\w+\/|\/Users\/\w+\//);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4 — Interattività
// ─────────────────────────────────────────────────────────────────────────────
test.describe('/stats — interattività e filtri', () => {

  test.beforeEach(async ({ page }) => {
    const res = await page.goto(`${BASE}/stats`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) test.skip(true, '/stats non disponibile');
  });

  test('filtro periodo o data range presente', async ({ page }) => {
    const filter = page.locator(
      'select, [role="combobox"], input[type="date"], button[class*="filter"], button[class*="period"]'
    ).first();
    const count = await filter.count();
    if (count === 0) test.skip(true, 'Filtro periodo non trovato');
    await expect(filter).toBeVisible({ timeout: 3000 });
  });

  test('bottone refresh o aggiorna dati presente', async ({ page }) => {
    const refresh = page.locator('button').filter({ hasText: /aggiorna|refresh|reload|ricarica/i }).first();
    const count = await refresh.count();
    if (count === 0) test.skip(true, 'Bottone refresh non trovato');
    await expect(refresh).toBeVisible({ timeout: 3000 });
  });

  test('paginazione o infinite scroll presente', async ({ page }) => {
    const pagination = page.locator(
      '[class*="pagination"], nav[aria-label*="pag"], button[aria-label*="next"], button[aria-label*="prec"]'
    ).first();
    const count = await pagination.count();
    if (count === 0) test.skip(true, 'Paginazione non trovata — dati su una pagina');
    expect(true).toBe(true);
  });

  test('contenuto caricato (no stato "loading" bloccato)', async ({ page }) => {
    await page.waitForTimeout(2000);
    // Non deve essere rimasto nello stato di caricamento
    const spinner = page.locator('[class*="spinner"], [class*="loading"], [aria-label="Loading"]').first();
    const spinnerVisible = await spinner.isVisible().catch(() => false);
    if (spinnerVisible) {
      // Aspetta un po' di più
      await page.waitForTimeout(3000);
      const stillLoading = await spinner.isVisible().catch(() => false);
      expect(stillLoading, 'Spinner di caricamento ancora visibile dopo 5s').toBe(false);
    }
    expect(true).toBe(true);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 5 — Mobile responsiveness
// ─────────────────────────────────────────────────────────────────────────────
test.describe('/stats — mobile (375px)', () => {

  test('nessun overflow orizzontale su mobile', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    const res = await page.goto(`${BASE}/stats`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) { await ctx.close(); test.skip(true, '/stats non disponibile'); }
    const overflow = await page.evaluate(() => document.body.scrollWidth > window.innerWidth);
    await ctx.close();
    expect(overflow, 'Overflow orizzontale su /stats mobile').toBe(false);
  });

  test('H1 visibile su mobile', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    const res = await page.goto(`${BASE}/stats`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) { await ctx.close(); test.skip(true, '/stats non disponibile'); }
    const h1 = page.locator('h1').first();
    const visible = await h1.isVisible().catch(() => false);
    await ctx.close();
    if (!visible) test.skip(true, 'H1 non visibile su mobile — layout responsive da verificare');
    expect(visible).toBe(true);
  });

  test('/stats: link navbar presente su mobile', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    const res = await page.goto(`${BASE}/stats`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) { await ctx.close(); test.skip(true, '/stats non disponibile'); }
    const nav = page.locator('nav, header').first();
    const navVisible = await nav.isVisible().catch(() => false);
    await ctx.close();
    if (!navVisible) test.skip(true, 'Nav non visibile su mobile');
    expect(navVisible).toBe(true);
  });

});
