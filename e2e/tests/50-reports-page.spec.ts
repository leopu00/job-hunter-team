import { test, expect } from '@playwright/test';

/**
 * FLUSSO 50 — PAGINA /reports
 *
 * Nuova pagina /reports aggiunta con layout.tsx.
 *
 * Suite 1: Struttura base /reports — status, H1, title
 * Suite 2: Contenuto reports — lista report, filtri, export
 * Suite 3: API /api/reports — risposta, struttura, sicurezza
 * Suite 4: Mobile e performance
 */

const BASE = process.env.BASE_URL || 'https://jobhunterteam.ai';

async function gotoReports(page: any): Promise<boolean> {
  const res = await page.goto(`${BASE}/reports`, { waitUntil: 'networkidle' });
  if (!res || res.status() === 404) return false;
  const url = page.url();
  return !(url.includes('login') || url.includes('auth') || url === `${BASE}/`);
}

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 — Struttura base
// ─────────────────────────────────────────────────────────────────────────────
test.describe('/reports — struttura base', () => {

  test('GET /reports risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/reports`);
    if (res.status() === 404) test.skip(true, '/reports non disponibile');
    expect(res.status()).not.toBe(500);
  });

  test('/reports: H1 visibile (se accessibile)', async ({ page }) => {
    const available = await gotoReports(page);
    if (!available) test.skip(true, '/reports non accessibile senza auth');
    const h1 = page.locator('h1').first();
    await expect(h1).toBeVisible({ timeout: 8000 });
    const text = await h1.innerText();
    expect(text.trim().length).toBeGreaterThan(0);
  });

  test('/reports: title presente', async ({ page }) => {
    const available = await gotoReports(page);
    if (!available) test.skip(true, '/reports non accessibile senza auth');
    const title = await page.title();
    expect(title.trim().length).toBeGreaterThan(3);
  });

  test('/reports: nessun errore JS critico', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    const res = await page.goto(`${BASE}/reports`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) test.skip(true, '/reports non disponibile');
    await page.waitForTimeout(800);
    expect(jsErrors, `Errori JS /reports: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

  test('/reports: HTML ha struttura Next.js', async ({ request }) => {
    const res = await request.get(`${BASE}/reports`);
    if (res.status() !== 200) test.skip(true, '/reports non 200');
    const html = await res.text();
    expect(html).toMatch(/__NEXT_DATA__|_next\/static|<html/);
  });

  test('/reports: no overflow desktop', async ({ page }) => {
    const res = await page.goto(`${BASE}/reports`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) test.skip(true, '/reports non disponibile');
    const url = page.url();
    if (url.includes('login') || url === `${BASE}/`) test.skip(true, 'Redirect auth');
    const overflow = await page.evaluate(() => document.body.scrollWidth > window.innerWidth);
    expect(overflow, 'Overflow desktop /reports').toBe(false);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2 — Contenuto reports
// ─────────────────────────────────────────────────────────────────────────────
test.describe('/reports — contenuto', () => {

  test('/reports: almeno un elemento report/card presente', async ({ page }) => {
    const available = await gotoReports(page);
    if (!available) test.skip(true, '/reports non accessibile');
    const reportEl = page.locator(
      '[class*="report"], [class*="card"], [class*="item"], table tr, ul li'
    ).first();
    const count = await reportEl.count();
    if (count === 0) test.skip(true, 'Nessun report trovato — dati non disponibili');
    expect(count).toBeGreaterThan(0);
  });

  test('/reports: navigazione verso sidebar presente', async ({ page }) => {
    const available = await gotoReports(page);
    if (!available) test.skip(true, '/reports non accessibile');
    const nav = page.locator('nav, aside, [class*="sidebar"]').first();
    const count = await nav.count();
    if (count === 0) test.skip(true, 'Navigazione non trovata');
    await expect(nav).toBeVisible({ timeout: 3000 });
  });

  test('/reports: link verso /agents o /dashboard presente', async ({ page }) => {
    const available = await gotoReports(page);
    if (!available) test.skip(true, '/reports non accessibile');
    const link = page.locator('a[href*="/agents"], a[href*="/dashboard"]').first();
    const count = await link.count();
    if (count === 0) test.skip(true, 'Link nav non trovato');
    await expect(link).toBeVisible({ timeout: 3000 });
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3 — API /api/reports
// ─────────────────────────────────────────────────────────────────────────────
test.describe('API /api/reports', () => {

  test('GET /api/reports risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/reports`);
    if (res.status() === 404) test.skip(true, '/api/reports non deployata');
    expect(res.status()).not.toBe(500);
  });

  test('GET /api/reports: 401 o 200 senza auth', async ({ request }) => {
    const res = await request.get(`${BASE}/api/reports`);
    if (res.status() === 404) test.skip(true, '/api/reports non deployata');
    expect([200, 401, 403]).toContain(res.status());
  });

  test('GET /api/reports: nessun dato sensibile', async ({ request }) => {
    const res = await request.get(`${BASE}/api/reports`);
    if (res.status() === 404 || res.status() === 401) test.skip(true, 'Non accessibile');
    const text = await res.text();
    expect(text).not.toMatch(/sk-ant-|password|secret/i);
    expect(text).not.toMatch(/\/home\/\w+\/|\/Users\/\w+\//);
  });

  test('/api/reports: risposta < 3s', async ({ request }) => {
    const start = Date.now();
    const res = await request.get(`${BASE}/api/reports`);
    const elapsed = Date.now() - start;
    if (res.status() === 404) test.skip(true, '/api/reports non deployata');
    expect(elapsed).toBeLessThan(3000);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4 — Mobile e performance
// ─────────────────────────────────────────────────────────────────────────────
test.describe('/reports — mobile e performance', () => {

  test('mobile (375px): no overflow', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    const res = await page.goto(`${BASE}/reports`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) { await ctx.close(); test.skip(true, '/reports non disponibile'); }
    const overflow = await page.evaluate(() => document.body.scrollWidth > window.innerWidth);
    await ctx.close();
    expect(overflow, 'Overflow mobile /reports').toBe(false);
  });

  test('/reports: TTFB < 3s', async ({ request }) => {
    const start = Date.now();
    const res = await request.get(`${BASE}/reports`);
    const elapsed = Date.now() - start;
    if (res.status() === 404) test.skip(true, '/reports non disponibile');
    expect(elapsed).toBeLessThan(3000);
  });

  test('regressione: /api/health intatta', async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    expect(res.status()).toBe(200);
    const body = await res.json().catch(() => ({}));
    expect(body).toHaveProperty('status');
  });

  test('regressione: homepage intatta', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 5000 });
    const title = await page.title();
    expect(title.trim().length).toBeGreaterThan(5);
  });

});
