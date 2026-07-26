import { test, expect } from '@playwright/test';

/**
 * FLUSSO 63 — CARDS AGGIORNATE: CompanyCard, InterviewCard, JobCard
 *
 * Suite 1: CompanyCard — /companies, no crash dopo aggiornamento
 * Suite 2: InterviewCard — /interviews, struttura e rendering
 * Suite 3: JobCard — aggiornamento iterativo, mobile
 * Suite 4: /setup layout aggiornato + regressione
 */

const BASE = process.env.BASE_URL || 'https://jobhunterteam.ai';

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 — CompanyCard aggiornata
// ─────────────────────────────────────────────────────────────────────────────
test.describe('CompanyCard — aggiornamento', () => {

  test('/companies: no crash JS dopo CompanyCard update', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    const res = await page.goto(`${BASE}/companies`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) test.skip(true, '/companies non disponibile');
    await page.waitForTimeout(500);
    expect(jsErrors, `CompanyCard crash: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

  test('/companies: risponde (non 500) dopo update', async ({ request }) => {
    const res = await request.get(`${BASE}/companies`);
    if (res.status() === 404) test.skip(true, '/companies non deployata');
    expect(res.status()).not.toBe(500);
  });

  test('/companies: mobile (375px) no crash', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    const res = await page.goto(`${BASE}/companies`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) { await ctx.close(); test.skip(true, '/companies non disponibile'); }
    await page.waitForTimeout(400);
    await ctx.close();
    expect(jsErrors, `CompanyCard mobile crash: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

  test('/api/companies: risponde dopo update', async ({ request }) => {
    const res = await request.get(`${BASE}/api/companies`);
    if (res.status() === 404) test.skip(true, '/api/companies non deployata');
    expect(res.status()).not.toBe(500);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2 — InterviewCard aggiornata
// ─────────────────────────────────────────────────────────────────────────────
test.describe('InterviewCard — aggiornamento', () => {

  test('/interviews: no crash JS dopo InterviewCard update', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    const res = await page.goto(`${BASE}/interviews`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) test.skip(true, '/interviews non disponibile');
    await page.waitForTimeout(500);
    expect(jsErrors, `InterviewCard crash: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

  test('/interviews: risponde (non 500) dopo update', async ({ request }) => {
    const res = await request.get(`${BASE}/interviews`);
    if (res.status() === 404) test.skip(true, '/interviews non deployata');
    expect(res.status()).not.toBe(500);
  });

  test('/interviews: H1 visibile (se accessibile)', async ({ page }) => {
    const res = await page.goto(`${BASE}/interviews`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) test.skip(true, '/interviews non disponibile');
    const url = page.url();
    if (url.includes('login') || url.includes('auth') || url === `${BASE}/`) {
      test.skip(true, '/interviews richiede auth');
    }
    const h1 = page.locator('h1').first();
    await expect(h1).toBeVisible({ timeout: 8000 });
  });

  test('/interviews: mobile (375px) no crash', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    const res = await page.goto(`${BASE}/interviews`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) { await ctx.close(); test.skip(true, '/interviews non disponibile'); }
    await page.waitForTimeout(400);
    await ctx.close();
    expect(jsErrors, `InterviewCard mobile crash: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

  test('/api/interviews: risponde dopo update', async ({ request }) => {
    const res = await request.get(`${BASE}/api/interviews`);
    if (res.status() === 404) test.skip(true, '/api/interviews non deployata');
    expect(res.status()).not.toBe(500);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3 — JobCard aggiornata (3a iterazione)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('JobCard — terzo aggiornamento', () => {

  test('/jobs: no crash JS (terzo update JobCard)', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    const res = await page.goto(`${BASE}/jobs`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) test.skip(true, '/jobs non disponibile');
    await page.waitForTimeout(500);
    expect(jsErrors, `JobCard crash: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

  test('/jobs: risponde (non 500) dopo terzo update', async ({ request }) => {
    const res = await request.get(`${BASE}/jobs`);
    if (res.status() === 404) test.skip(true, '/jobs non deployata');
    expect(res.status()).not.toBe(500);
  });

  test('/jobs: dark mode no crash (JobCard dark)', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    await page.emulateMedia({ colorScheme: 'dark' });
    const res = await page.goto(`${BASE}/jobs`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) test.skip(true, '/jobs non disponibile');
    await page.waitForTimeout(500);
    expect(jsErrors, `JobCard dark crash: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

  test('/api/jobs: risponde dopo update', async ({ request }) => {
    const res = await request.get(`${BASE}/api/jobs`);
    if (res.status() === 404) test.skip(true, '/api/jobs non deployata');
    expect(res.status()).not.toBe(500);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4 — /setup layout + regressione completa
// ─────────────────────────────────────────────────────────────────────────────
test.describe('/setup layout + regressione', () => {

  test('/setup: risponde (non 500) dopo layout update', async ({ request }) => {
    const res = await request.get(`${BASE}/setup`);
    if (res.status() === 404) test.skip(true, '/setup non deployata');
    expect(res.status()).not.toBe(500);
  });

  test('/setup: no crash JS', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    const res = await page.goto(`${BASE}/setup`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) test.skip(true, '/setup non disponibile');
    await page.waitForTimeout(400);
    expect(jsErrors, `Setup crash: ${jsErrors.join(', ')}`).toHaveLength(0);
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

  test('regressione: homepage no JS errors + H1 + nav', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    expect(jsErrors, `JS errors: ${jsErrors.join(', ')}`).toHaveLength(0);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('nav').first()).toBeVisible({ timeout: 5000 });
  });

});
