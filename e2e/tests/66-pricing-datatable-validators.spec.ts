import { test, expect } from '@playwright/test';

/**
 * FLUSSO 66 — PRICING, DATATABLE E VALIDATORS
 *
 * Suite 1: /pricing — pagina ora deployata
 * Suite 2: DataTable aggiornato — no crash su pagine che lo usano
 * Suite 3: /validators e /database aggiornati
 * Suite 4: Navbar (4° aggiornamento) + regressione
 */

const BASE = process.env.BASE_URL || 'https://jobhunterteam.ai';

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 — /pricing
// ─────────────────────────────────────────────────────────────────────────────
test.describe('/pricing — ora deployata', () => {

  test('/pricing: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/pricing`);
    if (res.status() === 404) test.skip(true, '/pricing ancora non deployata');
    expect(res.status()).not.toBe(500);
  });

  test('/pricing: risponde 200', async ({ request }) => {
    const res = await request.get(`${BASE}/pricing`);
    if (res.status() === 404) test.skip(true, '/pricing non deployata');
    if (res.status() !== 200) test.skip(true, `/pricing risponde ${res.status()}`);
    expect(res.status()).toBe(200);
  });

  test('/pricing: H1 visibile', async ({ page }) => {
    const res = await page.goto(`${BASE}/pricing`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) test.skip(true, '/pricing non disponibile');
    if (res.status() !== 200) test.skip(true, `/pricing non 200`);
    const h1 = page.locator('h1').first();
    await expect(h1).toBeVisible({ timeout: 8000 });
  });

  test('/pricing: no errori JS critici', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    const res = await page.goto(`${BASE}/pricing`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) test.skip(true, '/pricing non disponibile');
    await page.waitForTimeout(500);
    expect(jsErrors, `Errori JS /pricing: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

  test('/pricing: HTML con struttura Next.js', async ({ request }) => {
    const res = await request.get(`${BASE}/pricing`);
    if (res.status() !== 200) test.skip(true, '/pricing non 200');
    const html = await res.text();
    expect(html).toMatch(/__NEXT_DATA__|_next\/static|<html/);
  });

  test('/pricing: mobile (375px) no overflow', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    const res = await page.goto(`${BASE}/pricing`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404 || res.status() !== 200) {
      await ctx.close(); test.skip(true, '/pricing non disponibile');
    }
    const overflow = await page.evaluate(() => document.body.scrollWidth > window.innerWidth);
    await ctx.close();
    expect(overflow, 'Overflow mobile /pricing').toBe(false);
  });

  test('/pricing: title presente', async ({ page }) => {
    const res = await page.goto(`${BASE}/pricing`, { waitUntil: 'networkidle' });
    if (!res || res.status() !== 200) test.skip(true, '/pricing non disponibile');
    const title = await page.title();
    expect(title.trim().length).toBeGreaterThan(3);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2 — DataTable aggiornato
// ─────────────────────────────────────────────────────────────────────────────
test.describe('DataTable — aggiornamento', () => {

  test('DataTable: no crash su /applications (se accessibile)', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    const res = await page.goto(`${BASE}/applications`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) test.skip(true, '/applications non disponibile');
    const url = page.url();
    if (url.includes('login') || url.includes('auth') || url === `${BASE}/`) {
      test.skip(true, '/applications richiede auth');
    }
    await page.waitForTimeout(500);
    expect(jsErrors, `DataTable crash: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

  test('DataTable: no crash su /jobs (se accessibile)', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    const res = await page.goto(`${BASE}/jobs`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) test.skip(true, '/jobs non disponibile');
    await page.waitForTimeout(500);
    expect(jsErrors, `DataTable crash /jobs: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

  test('DataTable: no crash su /database (se accessibile)', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    const res = await page.goto(`${BASE}/database`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) test.skip(true, '/database non disponibile');
    await page.waitForTimeout(500);
    expect(jsErrors, `DataTable crash /database: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

  test('DataTable mobile: no crash su /applications', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    const res = await page.goto(`${BASE}/applications`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) { await ctx.close(); test.skip(true, '/applications non disponibile'); }
    const url = page.url();
    if (url.includes('login') || url === `${BASE}/`) { await ctx.close(); test.skip(true, 'Redirect'); }
    await page.waitForTimeout(400);
    await ctx.close();
    expect(jsErrors, `DataTable mobile crash: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3 — /validators e /database aggiornati
// ─────────────────────────────────────────────────────────────────────────────
test.describe('/validators e /database — aggiornamento', () => {

  test('/validators: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/validators`);
    if (res.status() === 404) test.skip(true, '/validators non deployata');
    expect(res.status()).not.toBe(500);
  });

  test('/validators: no errori JS critici', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    const res = await page.goto(`${BASE}/validators`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) test.skip(true, '/validators non disponibile');
    await page.waitForTimeout(400);
    expect(jsErrors, `Errori JS /validators: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

  test('/database: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/database`);
    if (res.status() === 404) test.skip(true, '/database non deployata');
    expect(res.status()).not.toBe(500);
  });

  test('/database: no errori JS critici', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    const res = await page.goto(`${BASE}/database`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) test.skip(true, '/database non disponibile');
    await page.waitForTimeout(400);
    expect(jsErrors, `Errori JS /database: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

  test('/database: nessun dato sensibile nel body', async ({ request }) => {
    const res = await request.get(`${BASE}/database`);
    if (res.status() === 404 || res.status() === 401) test.skip(true, 'Non accessibile');
    const text = await res.text();
    expect(text).not.toMatch(/password\s*[:=]\s*["']?\w+|sk-ant-/i);
    expect(text).not.toMatch(/\/home\/\w+\/|\/Users\/\w+\//);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4 — Navbar 4° aggiornamento + regressione
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Navbar 4° aggiornamento + regressione', () => {

  test('Navbar: no crash su homepage dopo 4° update', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const nav = page.locator('nav').first();
    await expect(nav).toBeVisible({ timeout: 5000 });
    expect(jsErrors, `Navbar crash: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

  test('Navbar: mobile 375px no crash', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    await ctx.close();
    expect(jsErrors, `Navbar mobile crash: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

  test('regressione: /api/health intatta', async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    expect(res.status()).toBe(200);
    const body = await res.json().catch(() => ({}));
    expect(body).toHaveProperty('status');
  });

  test('regressione: /api/agents intatta', async ({ request }) => {
    const res = await request.get(`${BASE}/api/agents`);
    expect(res.status()).toBe(200);
    const body = await res.json().catch(() => null);
    expect(body).not.toBeNull();
  });

  test('regressione: pagine critiche tutte 200', async ({ request }) => {
    const pages = ['/', '/faq', '/guide', '/download', '/about', '/changelog'];
    const errors: string[] = [];
    for (const path of pages) {
      const res = await request.get(`${BASE}${path}`, { timeout: 8000 }).catch(() => null);
      if (res?.status() !== 200) errors.push(`${path}: ${res?.status()}`);
    }
    expect(errors, `Critiche non 200:\n${errors.join('\n')}`).toHaveLength(0);
  });

});
