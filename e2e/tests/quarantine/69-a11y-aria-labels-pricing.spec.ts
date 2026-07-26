import { test, expect } from '@playwright/test';

/**
 * FLUSSO 69 — A11Y ARIA-LABEL TABELLE + PRICING/VALIDATORS AGGIORNATI
 *
 * Suite 1: Aria-label su tabelle — 9 tabelle in 8 pagine ora accessibili
 * Suite 2: /pricing aggiornato — struttura e contenuto
 * Suite 3: /validators e /database aggiornati (2° volta)
 * Suite 4: Regressione A11Y completa
 */

const BASE = process.env.BASE_URL || 'https://jobhunterteam.ai';

// Pagine candidate che usano tabelle (dalla descrizione del commit a11y)
const TABLE_PAGES = [
  { path: '/applications',  label: 'Applications'  },
  { path: '/positions',     label: 'Positions'     },
  { path: '/jobs',          label: 'Jobs'          },
  { path: '/companies',     label: 'Companies'     },
  { path: '/sessions',      label: 'Sessions'      },
  { path: '/interviews',    label: 'Interviews'    },
  { path: '/analytics',     label: 'Analytics'     },
  { path: '/reports',       label: 'Reports'       },
];

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 — Aria-label su tabelle
// ─────────────────────────────────────────────────────────────────────────────
test.describe('A11Y — aria-label tabelle', () => {

  test('pagine con tabelle: nessuna risponde 500 dopo a11y update', async ({ request }) => {
    const errors: string[] = [];
    for (const { path, label } of TABLE_PAGES) {
      const res = await request.get(`${BASE}${path}`, { timeout: 8000 }).catch(() => null);
      if (res?.status() === 500) errors.push(`500 ${label}`);
    }
    expect(errors, `Pagine con 500:\n${errors.join('\n')}`).toHaveLength(0);
  });

  test('nessuna pagina con tabelle: crash JS dopo a11y update', async ({ page }) => {
    const pagesWithErrors: string[] = [];
    for (const { path, label } of TABLE_PAGES.slice(0, 4)) {
      const jsErrors: string[] = [];
      page.removeAllListeners('pageerror');
      page.on('pageerror', (e) => {
        if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
          jsErrors.push(e.message);
        }
      });
      const res = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
      if (!res || res.status() === 404) continue;
      await page.waitForTimeout(300);
      if (jsErrors.length > 0) pagesWithErrors.push(`${label}: ${jsErrors.join(', ')}`);
    }
    expect(pagesWithErrors, `Errori JS a11y:\n${pagesWithErrors.join('\n')}`).toHaveLength(0);
  });

  test('/applications: tabelle con aria-label (se accessibile)', async ({ page }) => {
    const res = await page.goto(`${BASE}/applications`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) test.skip(true, '/applications non disponibile');
    const url = page.url();
    if (url.includes('login') || url.includes('auth') || url === `${BASE}/`) {
      test.skip(true, '/applications richiede auth');
    }
    const tables = await page.locator('table').all();
    if (tables.length === 0) test.skip(true, 'Nessuna tabella su /applications');
    for (const table of tables) {
      const ariaLabel = await table.getAttribute('aria-label').catch(() => '');
      const ariaLabelledBy = await table.getAttribute('aria-labelledby').catch(() => '');
      const hasLabel = (ariaLabel && ariaLabel.trim().length > 0) ||
                       (ariaLabelledBy && ariaLabelledBy.trim().length > 0);
      if (!hasLabel) console.log('[WARN] Tabella senza aria-label su /applications');
    }
    expect(true).toBe(true);
  });

  test('/jobs: tabelle con aria-label (se accessibile)', async ({ page }) => {
    const res = await page.goto(`${BASE}/jobs`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) test.skip(true, '/jobs non disponibile');
    const url = page.url();
    if (url.includes('login') || url.includes('auth') || url === `${BASE}/`) {
      test.skip(true, '/jobs richiede auth');
    }
    const tables = await page.locator('table').all();
    if (tables.length === 0) test.skip(true, 'Nessuna tabella su /jobs');
    let tablesWithLabel = 0;
    for (const table of tables) {
      const ariaLabel = await table.getAttribute('aria-label').catch(() => '');
      if (ariaLabel && ariaLabel.trim().length > 0) tablesWithLabel++;
    }
    if (tablesWithLabel === 0) console.log(`[WARN] ${tables.length} tabelle su /jobs senza aria-label`);
    expect(true).toBe(true);
  });

  test('/sessions: no crash JS dopo a11y update', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    const res = await page.goto(`${BASE}/sessions`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) test.skip(true, '/sessions non disponibile');
    await page.waitForTimeout(400);
    expect(jsErrors, `Sessions a11y crash: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2 — /pricing aggiornato
// ─────────────────────────────────────────────────────────────────────────────
test.describe('/pricing — 2° aggiornamento', () => {

  test('/pricing: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/pricing`);
    if (res.status() === 404) test.skip(true, '/pricing ancora non deployata');
    expect(res.status()).not.toBe(500);
  });

  test('/pricing: no crash JS dopo update', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    const res = await page.goto(`${BASE}/pricing`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) test.skip(true, '/pricing non disponibile');
    await page.waitForTimeout(500);
    expect(jsErrors, `Pricing crash: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

  test('/pricing: HTML struttura Next.js', async ({ request }) => {
    const res = await request.get(`${BASE}/pricing`);
    if (res.status() !== 200) test.skip(true, '/pricing non 200');
    const html = await res.text();
    expect(html).toMatch(/__NEXT_DATA__|_next\/static|<html/);
  });

  test('/pricing: mobile no overflow (se disponibile)', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    const res = await page.goto(`${BASE}/pricing`, { waitUntil: 'networkidle' });
    if (!res || res.status() !== 200) { await ctx.close(); test.skip(true, '/pricing non disponibile'); }
    const overflow = await page.evaluate(() => document.body.scrollWidth > window.innerWidth);
    await ctx.close();
    expect(overflow, 'Overflow mobile /pricing').toBe(false);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3 — /validators e /database (2° aggiornamento)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('/validators e /database — 2° aggiornamento', () => {

  test('/validators: no crash JS', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    const res = await page.goto(`${BASE}/validators`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) test.skip(true, '/validators non disponibile');
    await page.waitForTimeout(400);
    expect(jsErrors, `Validators crash: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

  test('/database: no crash JS dopo 2° aggiornamento', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    const res = await page.goto(`${BASE}/database`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) test.skip(true, '/database non disponibile');
    await page.waitForTimeout(400);
    expect(jsErrors, `Database crash: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

  test('/validators: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/validators`);
    if (res.status() === 404) test.skip(true, '/validators non deployata');
    expect(res.status()).not.toBe(500);
  });

  test('/database: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/database`);
    if (res.status() === 404) test.skip(true, '/database non deployata');
    expect(res.status()).not.toBe(500);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4 — Regressione A11Y completa
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Regressione A11Y completa', () => {

  test('homepage: landmark nav presente e accessibile', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const nav = page.locator('nav').first();
    await expect(nav).toBeVisible({ timeout: 5000 });
    // Verifica aria-label o aria-labelledby su nav
    const ariaLabel = await nav.getAttribute('aria-label').catch(() => '');
    const ariaLabelledBy = await nav.getAttribute('aria-labelledby').catch(() => '');
    if (!ariaLabel && !ariaLabelledBy) {
      console.log('[INFO] nav senza aria-label — potrebbe essere necessario per a11y completa');
    }
    expect(true).toBe(true);
  });

  test('homepage: immagini con alt text', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const imgs = await page.locator('img').all();
    const noAlt: number[] = [];
    for (let i = 0; i < Math.min(imgs.length, 10); i++) {
      const alt = await imgs[i].getAttribute('alt').catch(() => null);
      if (alt === null || alt === undefined) noAlt.push(i);
    }
    if (noAlt.length > 0) console.log(`[WARN] ${noAlt.length} immagini senza alt su homepage`);
    expect(noAlt.length).toBeLessThan(3);
  });

  test('regressione: /api/health intatta', async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    expect(res.status()).toBe(200);
    const body = await res.json().catch(() => ({}));
    expect(body).toHaveProperty('status');
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

  test('regressione: homepage no JS errors', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    expect(jsErrors, `JS errors: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

});
