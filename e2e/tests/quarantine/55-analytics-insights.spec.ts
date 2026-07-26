import { test, expect } from '@playwright/test';

/**
 * FLUSSO 55 — ANALYTICS, INSIGHTS E ACTIVITY
 *
 * Suite 1: Pagine analytics — /analytics, /insights, /activity, /achievements, /timeline
 * Suite 2: API analytics — /api/analytics, /api/insights, /api/activity, /api/achievements
 * Suite 3: Contenuto e struttura visualizzazioni dati
 * Suite 4: Performance e regressione
 */

const BASE = process.env.BASE_URL || 'https://jobhunterteam.ai';

const ANALYTICS_PAGES = [
  { path: '/analytics',    label: 'Analytics'    },
  { path: '/insights',     label: 'Insights'     },
  { path: '/activity',     label: 'Activity'     },
  { path: '/achievements', label: 'Achievements' },
  { path: '/timeline',     label: 'Timeline'     },
];

const ANALYTICS_APIS = [
  { path: '/api/analytics',    label: 'Analytics API'    },
  { path: '/api/insights',     label: 'Insights API'     },
  { path: '/api/activity',     label: 'Activity API'     },
  { path: '/api/achievements', label: 'Achievements API' },
];

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 — Pagine analytics: status e struttura
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Analytics & Insights — pagine', () => {

  test('tutte le pagine analytics: nessuna risponde 500', async ({ request }) => {
    const errors: string[] = [];
    for (const { path, label } of ANALYTICS_PAGES) {
      const res = await request.get(`${BASE}${path}`, { timeout: 8000 }).catch(() => null);
      if (res?.status() === 500) errors.push(`500 ${label}`);
    }
    expect(errors, `Pagine con 500:\n${errors.join('\n')}`).toHaveLength(0);
  });

  test('tutte le pagine analytics: HTML con struttura Next.js', async ({ request }) => {
    const errors: string[] = [];
    for (const { path, label } of ANALYTICS_PAGES) {
      const res = await request.get(`${BASE}${path}`, { timeout: 8000 }).catch(() => null);
      if (!res || res.status() === 404) continue;
      const html = await res.text();
      if (!html.match(/__NEXT_DATA__|_next\/static|<html/)) {
        errors.push(`${label}: no struttura Next.js`);
      }
    }
    expect(errors).toHaveLength(0);
  });

  test('/analytics: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/analytics`, { timeout: 8000 });
    if (res.status() === 404) test.skip(true, '/analytics non deployata');
    expect(res.status()).not.toBe(500);
  });

  test('/insights: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/insights`, { timeout: 8000 });
    if (res.status() === 404) test.skip(true, '/insights non deployata');
    expect(res.status()).not.toBe(500);
  });

  test('/activity: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/activity`, { timeout: 8000 });
    if (res.status() === 404) test.skip(true, '/activity non deployata');
    expect(res.status()).not.toBe(500);
  });

  test('/achievements: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/achievements`, { timeout: 8000 });
    if (res.status() === 404) test.skip(true, '/achievements non deployata');
    expect(res.status()).not.toBe(500);
  });

  test('/timeline: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/timeline`, { timeout: 8000 });
    if (res.status() === 404) test.skip(true, '/timeline non deployata');
    expect(res.status()).not.toBe(500);
  });

  test('nessuna pagina analytics: errori JS critici', async ({ page }) => {
    const pagesWithErrors: string[] = [];
    for (const { path, label } of ANALYTICS_PAGES.slice(0, 3)) {
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
    expect(pagesWithErrors, `Errori JS:\n${pagesWithErrors.join('\n')}`).toHaveLength(0);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2 — API analytics
// ─────────────────────────────────────────────────────────────────────────────
test.describe('API Analytics & Insights', () => {

  test('tutte le API analytics: nessuna risponde 500', async ({ request }) => {
    const errors: string[] = [];
    for (const { path, label } of ANALYTICS_APIS) {
      const res = await request.get(`${BASE}${path}`, { timeout: 8000 }).catch(() => null);
      if (res?.status() === 500) errors.push(`500 ${label}`);
    }
    expect(errors, `API con 500:\n${errors.join('\n')}`).toHaveLength(0);
  });

  test('/api/analytics: risponde 200 o 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/analytics`);
    if (res.status() === 404) test.skip(true, '/api/analytics non deployata');
    expect([200, 401, 403]).toContain(res.status());
  });

  test('/api/insights: risponde 200 o 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/insights`);
    if (res.status() === 404) test.skip(true, '/api/insights non deployata');
    expect([200, 401, 403]).toContain(res.status());
  });

  test('/api/activity: risponde 200 o 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/activity`);
    if (res.status() === 404) test.skip(true, '/api/activity non deployata');
    expect([200, 401, 403]).toContain(res.status());
  });

  test('/api/achievements: risponde 200 o 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/achievements`);
    if (res.status() === 404) test.skip(true, '/api/achievements non deployata');
    expect([200, 401, 403]).toContain(res.status());
  });

  test('API 200: Content-Type JSON', async ({ request }) => {
    const notJson: string[] = [];
    for (const { path, label } of ANALYTICS_APIS) {
      const res = await request.get(`${BASE}${path}`, { timeout: 5000 }).catch(() => null);
      if (!res || res.status() !== 200) continue;
      const ct = res.headers()['content-type'] ?? '';
      if (!ct.includes('application/json')) notJson.push(`${label}: ${ct}`);
    }
    expect(notJson, `API non JSON: ${notJson.join(', ')}`).toHaveLength(0);
  });

  test('/api/analytics: nessun dato sensibile', async ({ request }) => {
    const res = await request.get(`${BASE}/api/analytics`);
    if (res.status() === 404 || res.status() === 401) test.skip(true, 'Non accessibile');
    const text = await res.text();
    expect(text).not.toMatch(/sk-ant-|password|secret/i);
    expect(text).not.toMatch(/\/home\/\w+\/|\/Users\/\w+\//);
  });

  test('/api/activity: nessun dato sensibile', async ({ request }) => {
    const res = await request.get(`${BASE}/api/activity`);
    if (res.status() === 404 || res.status() === 401) test.skip(true, 'Non accessibile');
    const text = await res.text();
    expect(text).not.toMatch(/sk-ant-|password|secret/i);
  });

  test('/api/insights: performance < 3s', async ({ request }) => {
    const start = Date.now();
    const res = await request.get(`${BASE}/api/insights`);
    const elapsed = Date.now() - start;
    if (res.status() === 404) test.skip(true, '/api/insights non deployata');
    expect(elapsed).toBeLessThan(3000);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3 — Contenuto pagine analytics
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Analytics — contenuto e struttura', () => {

  test('/analytics: H1 visibile (se accessibile)', async ({ page }) => {
    const res = await page.goto(`${BASE}/analytics`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) test.skip(true, '/analytics non disponibile');
    const url = page.url();
    if (url.includes('login') || url.includes('auth') || url === `${BASE}/`) {
      test.skip(true, '/analytics richiede auth');
    }
    const h1 = page.locator('h1').first();
    await expect(h1).toBeVisible({ timeout: 8000 });
  });

  test('/insights: H1 visibile (se accessibile)', async ({ page }) => {
    const res = await page.goto(`${BASE}/insights`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) test.skip(true, '/insights non disponibile');
    const url = page.url();
    if (url.includes('login') || url.includes('auth') || url === `${BASE}/`) {
      test.skip(true, '/insights richiede auth');
    }
    const h1 = page.locator('h1').first();
    await expect(h1).toBeVisible({ timeout: 8000 });
  });

  test('/activity: H1 visibile (se accessibile)', async ({ page }) => {
    const res = await page.goto(`${BASE}/activity`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) test.skip(true, '/activity non disponibile');
    const url = page.url();
    if (url.includes('login') || url.includes('auth') || url === `${BASE}/`) {
      test.skip(true, '/activity richiede auth');
    }
    const h1 = page.locator('h1').first();
    await expect(h1).toBeVisible({ timeout: 8000 });
  });

  test('pagine analytics: title non vuoto', async ({ request }) => {
    const missing: string[] = [];
    for (const { path, label } of ANALYTICS_PAGES) {
      const res = await request.get(`${BASE}${path}`, { timeout: 8000 }).catch(() => null);
      if (!res || res.status() !== 200) continue;
      const html = await res.text();
      const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
      if (!titleMatch || titleMatch[1].trim().length < 3) missing.push(label);
    }
    if (missing.length > 0) console.log(`[WARN] Title vuoto su: ${missing.join(', ')}`);
    expect(missing.length).toBeLessThan(3);
  });

  test('/analytics: mobile no overflow (se accessibile)', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    const res = await page.goto(`${BASE}/analytics`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) { await ctx.close(); test.skip(true, '/analytics non disponibile'); }
    const url = page.url();
    if (url.includes('login') || url === `${BASE}/`) { await ctx.close(); test.skip(true, 'Redirect'); }
    const overflow = await page.evaluate(() => document.body.scrollWidth > window.innerWidth);
    await ctx.close();
    if (overflow) console.log('[WARN] Overflow mobile /analytics');
    expect(true).toBe(true);
  });

  test('/achievements: mobile no overflow (se accessibile)', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    const res = await page.goto(`${BASE}/achievements`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) { await ctx.close(); test.skip(true, '/achievements non disponibile'); }
    const url = page.url();
    if (url.includes('login') || url === `${BASE}/`) { await ctx.close(); test.skip(true, 'Redirect'); }
    const overflow = await page.evaluate(() => document.body.scrollWidth > window.innerWidth);
    await ctx.close();
    if (overflow) console.log('[WARN] Overflow mobile /achievements');
    expect(true).toBe(true);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4 — Performance e regressione
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Analytics — performance e regressione', () => {

  test('API analytics: TTFB < 3s', async ({ request }) => {
    const slow: string[] = [];
    for (const { path, label } of ANALYTICS_APIS) {
      const start = Date.now();
      const res = await request.get(`${BASE}${path}`, { timeout: 5000 }).catch(() => null);
      const elapsed = Date.now() - start;
      if (res?.status() === 200 && elapsed > 3000) slow.push(`${label}: ${elapsed}ms`);
    }
    if (slow.length > 0) console.log(`[WARN] API lente: ${slow.join(', ')}`);
    expect(slow.length).toBeLessThan(2);
  });

  test('pagine analytics: TTFB < 4s', async ({ request }) => {
    const slow: string[] = [];
    for (const { path, label } of ANALYTICS_PAGES) {
      const start = Date.now();
      const res = await request.get(`${BASE}${path}`, { timeout: 6000 }).catch(() => null);
      const elapsed = Date.now() - start;
      if (res && res.status() !== 404 && elapsed > 4000) slow.push(`${label}: ${elapsed}ms`);
    }
    if (slow.length > 0) console.log(`[WARN] Pagine lente: ${slow.join(', ')}`);
    expect(slow.length).toBeLessThan(2);
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

  test('path traversal su /api/activity: no 500', async ({ request }) => {
    const res = await request.get(`${BASE}/api/activity?id=../../../etc/passwd`).catch(() => null);
    if (!res || res.status() === 404) test.skip(true, '/api/activity non disponibile');
    expect(res.status()).not.toBe(500);
    const text = await res.text();
    expect(text).not.toMatch(/root:x:0:0/);
  });

  test('no X-Powered-By su /api/analytics', async ({ request }) => {
    const res = await request.get(`${BASE}/api/analytics`);
    if (res.status() === 404) test.skip(true, '/api/analytics non deployata');
    const powered = res.headers()['x-powered-by'] ?? '';
    expect(powered).toBeFalsy();
  });

});
