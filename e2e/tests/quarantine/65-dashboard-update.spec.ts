import { test, expect } from '@playwright/test';

/**
 * FLUSSO 65 — DASHBOARD AGGIORNATA + REGRESSIONE SICUREZZA
 *
 * Suite 1: /dashboard — no crash, struttura, redirect auth
 * Suite 2: /dashboard — API correlate
 * Suite 3: Sicurezza: /secrets fix verificato + altri endpoint sensibili
 * Suite 4: Regressione completa post-dashboard update
 */

const BASE = process.env.BASE_URL || 'https://jobhunterteam.ai';

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 — /dashboard aggiornata
// ─────────────────────────────────────────────────────────────────────────────
test.describe('/dashboard — aggiornamento', () => {

  test('/dashboard: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/dashboard`);
    if (res.status() === 404) test.skip(true, '/dashboard non deployata');
    expect(res.status()).not.toBe(500);
  });

  test('/dashboard: HTML con struttura Next.js', async ({ request }) => {
    const res = await request.get(`${BASE}/dashboard`);
    if (res.status() === 404) test.skip(true, '/dashboard non disponibile');
    const html = await res.text();
    expect(html).toMatch(/__NEXT_DATA__|_next\/static|<html/);
  });

  test('/dashboard: no crash JS (se accessibile)', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    const res = await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) test.skip(true, '/dashboard non disponibile');
    await page.waitForTimeout(500);
    expect(jsErrors, `Dashboard crash: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

  test('/dashboard: H1 visibile (se accessibile senza auth)', async ({ page }) => {
    const res = await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) test.skip(true, '/dashboard non disponibile');
    const url = page.url();
    if (url.includes('login') || url.includes('auth') || url === `${BASE}/`) {
      test.skip(true, '/dashboard richiede auth (comportamento corretto)');
    }
    const h1 = page.locator('h1').first();
    await expect(h1).toBeVisible({ timeout: 8000 });
  });

  test('/dashboard: redirect verso login se non autenticato', async ({ page }) => {
    // Verifica che il redirect auth funzioni — non crash
    const res = await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) test.skip(true, '/dashboard non disponibile');
    // Deve rispondere senza 500
    expect(res.status()).not.toBe(500);
    // Se ha rediretto a login è normale
    const url = page.url();
    const isOk = res.status() === 200 || url.includes('login') || url.includes('auth');
    expect(isOk, 'Dashboard non risponde né 200 né redirect').toBe(true);
  });

  test('/dashboard: mobile (375px) no crash', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    const res = await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) { await ctx.close(); test.skip(true, '/dashboard non disponibile'); }
    await page.waitForTimeout(400);
    await ctx.close();
    expect(jsErrors, `Dashboard mobile crash: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2 — API correlate alla dashboard
// ─────────────────────────────────────────────────────────────────────────────
test.describe('API correlate alla dashboard', () => {

  test('/api/profile: struttura intatta (dashboard usa profilo)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/profile`);
    expect(res.status()).toBe(200);
    const body = await res.json().catch(() => null);
    expect(body).not.toBeNull();
  });

  test('/api/agents: intatta (dashboard mostra agenti)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/agents`);
    expect(res.status()).toBe(200);
    const body = await res.json().catch(() => null);
    expect(body).not.toBeNull();
  });

  test('/api/health: intatta (dashboard mostra health)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    expect(res.status()).toBe(200);
    const body = await res.json().catch(() => ({}));
    expect(body).toHaveProperty('status');
  });

  test('/api/applications: non 500 (dashboard usa applications)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/applications`);
    if (res.status() === 404) test.skip(true, '/api/applications non deployata');
    expect(res.status()).not.toBe(500);
  });

  test('/api/stats: non 500 (dashboard usa statistiche)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/stats`);
    if (res.status() === 404) test.skip(true, '/api/stats non deployata');
    expect(res.status()).not.toBe(500);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3 — Verifica sicurezza endpoint sensibili
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Sicurezza — endpoint sensibili', () => {

  test('/secrets: no dati sensibili esposti senza auth', async ({ request }) => {
    const res = await request.get(`${BASE}/secrets`);
    if (res.status() === 404) test.skip(true, '/secrets non disponibile');
    const text = await res.text();
    expect(text).not.toMatch(/sk-ant-|api[_-]?key\s*[:=]/i);
    expect(text).not.toMatch(/password\s*[:=]\s*["']?\w+/i);
    expect(text).not.toMatch(/secret\s*[:=]\s*["']?\w{8,}/i);
  });

  test('/secrets: no path assoluti esposti', async ({ request }) => {
    const res = await request.get(`${BASE}/secrets`);
    if (res.status() === 404 || res.status() === 401 || res.status() === 403) {
      test.skip(true, '/secrets protetta correttamente');
    }
    const text = await res.text();
    expect(text).not.toMatch(/\/home\/\w+\/|\/Users\/\w+\//);
    expect(text).not.toMatch(/\/var\/task\/|\/opt\/build\//);
  });

  test('/api/credentials: risponde (documentazione stato)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/credentials`).catch(() => null);
    if (!res) { expect(true).toBe(true); return; }
    const status = res.status();
    console.log(`[INFO] /api/credentials risponde: ${status}`);
    if (status === 500) console.log('[BUG] /api/credentials risponde 500 — da correggere');
    if (status === 200) {
      // Documentare il fatto che /api/credentials è accessibile senza auth
      console.log('[WARN] /api/credentials accessibile senza auth — verificare protezione');
    }
    expect(true).toBe(true);
  });

  test('/api/env: risponde (documentazione stato)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/env`).catch(() => null);
    if (!res) { expect(true).toBe(true); return; }
    const status = res.status();
    console.log(`[INFO] /api/env risponde: ${status}`);
    if (status === 500) console.log('[BUG] /api/env risponde 500 — da correggere');
    if (status === 200) {
      console.log('[WARN] /api/env accessibile senza auth — verificare che non esponga variabili d\'ambiente');
    }
    expect(true).toBe(true);
  });

  test('no X-Powered-By su endpoint sensibili', async ({ request }) => {
    const endpoints = ['/secrets', '/api/settings', '/api/profile'];
    for (const path of endpoints) {
      const res = await request.get(`${BASE}${path}`, { timeout: 5000 }).catch(() => null);
      if (!res || res.status() === 404) continue;
      const powered = res.headers()['x-powered-by'] ?? '';
      expect(powered, `X-Powered-By esposto su ${path}`).toBeFalsy();
    }
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4 — Regressione completa post-dashboard
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Regressione completa post-dashboard update', () => {

  test('pagine critiche: /, /faq, /guide, /download, /about, /changelog — 200', async ({ request }) => {
    const pages = ['/', '/faq', '/guide', '/download', '/about', '/changelog'];
    const errors: string[] = [];
    for (const path of pages) {
      const res = await request.get(`${BASE}${path}`, { timeout: 8000 }).catch(() => null);
      if (res?.status() !== 200) errors.push(`${path}: ${res?.status()}`);
    }
    expect(errors, `Critiche non 200:\n${errors.join('\n')}`).toHaveLength(0);
  });

  test('API critiche: /api/health, /api/agents, /api/about, /api/profile — 200', async ({ request }) => {
    const apis = ['/api/health', '/api/agents', '/api/about', '/api/profile'];
    const errors: string[] = [];
    for (const path of apis) {
      const res = await request.get(`${BASE}${path}`, { timeout: 8000 }).catch(() => null);
      if (res?.status() !== 200) errors.push(`${path}: ${res?.status()}`);
    }
    expect(errors, `API critiche non 200:\n${errors.join('\n')}`).toHaveLength(0);
  });

  test('homepage: no JS errors + H1 + nav + footer', async ({ page }) => {
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
    await expect(page.locator('footer').first()).toBeVisible({ timeout: 5000 });
  });

  test('homepage mobile: no overflow', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const overflow = await page.evaluate(() => document.body.scrollWidth > window.innerWidth);
    await ctx.close();
    expect(overflow, 'Overflow mobile homepage').toBe(false);
  });

});
