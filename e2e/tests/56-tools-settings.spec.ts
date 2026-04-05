import { test, expect } from '@playwright/test';

/**
 * FLUSSO 56 — TOOLS, SETTINGS E NOTIFICHE
 *
 * Suite 1: Pagine tools — /settings, /tools, /notifications, /search, /alerts
 * Suite 2: API — /api/settings, /api/tools, /api/notifications, /api/alerts
 * Suite 3: Contenuto e struttura
 * Suite 4: Sicurezza settings + manifest.json (PWA ora deployato)
 */

const BASE = process.env.BASE_URL || 'https://jobhunterteam.ai';

const TOOLS_PAGES = [
  { path: '/settings',      label: 'Settings'      },
  { path: '/tools',         label: 'Tools'         },
  { path: '/notifications', label: 'Notifications' },
  { path: '/search',        label: 'Search'        },
  { path: '/alerts',        label: 'Alerts'        },
];

const TOOLS_APIS = [
  { path: '/api/settings',      label: 'Settings API'      },
  { path: '/api/tools',         label: 'Tools API'         },
  { path: '/api/notifications', label: 'Notifications API' },
  { path: '/api/alerts',        label: 'Alerts API'        },
];

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 — Pagine tools e settings
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Tools & Settings — pagine', () => {

  test('tutte le pagine tools: nessuna risponde 500', async ({ request }) => {
    const errors: string[] = [];
    for (const { path, label } of TOOLS_PAGES) {
      const res = await request.get(`${BASE}${path}`, { timeout: 8000 }).catch(() => null);
      if (res?.status() === 500) errors.push(`500 ${label}`);
    }
    expect(errors, `Pagine con 500:\n${errors.join('\n')}`).toHaveLength(0);
  });

  test('tutte le pagine tools: HTML con struttura Next.js', async ({ request }) => {
    const errors: string[] = [];
    for (const { path, label } of TOOLS_PAGES) {
      const res = await request.get(`${BASE}${path}`, { timeout: 8000 }).catch(() => null);
      if (!res || res.status() === 404) continue;
      const html = await res.text();
      if (!html.match(/__NEXT_DATA__|_next\/static|<html/)) {
        errors.push(`${label}: no struttura Next.js`);
      }
    }
    expect(errors).toHaveLength(0);
  });

  test('/settings: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/settings`, { timeout: 8000 });
    if (res.status() === 404) test.skip(true, '/settings non deployata');
    expect(res.status()).not.toBe(500);
  });

  test('/notifications: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/notifications`, { timeout: 8000 });
    if (res.status() === 404) test.skip(true, '/notifications non deployata');
    expect(res.status()).not.toBe(500);
  });

  test('/search: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/search`, { timeout: 8000 });
    if (res.status() === 404) test.skip(true, '/search non deployata');
    expect(res.status()).not.toBe(500);
  });

  test('/alerts: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/alerts`, { timeout: 8000 });
    if (res.status() === 404) test.skip(true, '/alerts non deployata');
    expect(res.status()).not.toBe(500);
  });

  test('/tools: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/tools`, { timeout: 8000 });
    if (res.status() === 404) test.skip(true, '/tools non deployata');
    expect(res.status()).not.toBe(500);
  });

  test('nessuna pagina tools: errori JS critici', async ({ page }) => {
    const pagesWithErrors: string[] = [];
    for (const { path, label } of TOOLS_PAGES.slice(0, 3)) {
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
// SUITE 2 — API tools e settings
// ─────────────────────────────────────────────────────────────────────────────
test.describe('API Tools & Settings', () => {

  test('tutte le API tools: nessuna risponde 500', async ({ request }) => {
    const errors: string[] = [];
    for (const { path, label } of TOOLS_APIS) {
      const res = await request.get(`${BASE}${path}`, { timeout: 8000 }).catch(() => null);
      if (res?.status() === 500) errors.push(`500 ${label}`);
    }
    expect(errors, `API con 500:\n${errors.join('\n')}`).toHaveLength(0);
  });

  test('/api/settings: risponde 200 o 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/settings`);
    if (res.status() === 404) test.skip(true, '/api/settings non deployata');
    expect([200, 401, 403]).toContain(res.status());
  });

  test('/api/notifications: risponde 200 o 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/notifications`);
    if (res.status() === 404) test.skip(true, '/api/notifications non deployata');
    expect([200, 401, 403]).toContain(res.status());
  });

  test('/api/alerts: risponde 200 o 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/alerts`);
    if (res.status() === 404) test.skip(true, '/api/alerts non deployata');
    expect([200, 401, 403]).toContain(res.status());
  });

  test('API 200: Content-Type JSON', async ({ request }) => {
    const notJson: string[] = [];
    for (const { path, label } of TOOLS_APIS) {
      const res = await request.get(`${BASE}${path}`, { timeout: 5000 }).catch(() => null);
      if (!res || res.status() !== 200) continue;
      const ct = res.headers()['content-type'] ?? '';
      if (!ct.includes('application/json')) notJson.push(`${label}: ${ct}`);
    }
    expect(notJson, `API non JSON: ${notJson.join(', ')}`).toHaveLength(0);
  });

  test('/api/settings: nessun dato sensibile', async ({ request }) => {
    const res = await request.get(`${BASE}/api/settings`);
    if (res.status() === 404 || res.status() === 401) test.skip(true, 'Non accessibile');
    const text = await res.text();
    expect(text).not.toMatch(/sk-ant-|password|secret|api[_-]?key/i);
    expect(text).not.toMatch(/\/home\/\w+\/|\/Users\/\w+\//);
  });

  test('/api/notifications: nessun dato sensibile', async ({ request }) => {
    const res = await request.get(`${BASE}/api/notifications`);
    if (res.status() === 404 || res.status() === 401) test.skip(true, 'Non accessibile');
    const text = await res.text();
    expect(text).not.toMatch(/sk-ant-|password|secret/i);
  });

  test('/api/tools: performance < 3s', async ({ request }) => {
    const start = Date.now();
    const res = await request.get(`${BASE}/api/tools`);
    const elapsed = Date.now() - start;
    if (res.status() === 404) test.skip(true, '/api/tools non deployata');
    expect(elapsed).toBeLessThan(3000);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3 — Contenuto pagine
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Tools & Settings — contenuto', () => {

  test('/settings: H1 visibile (se accessibile)', async ({ page }) => {
    const res = await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) test.skip(true, '/settings non disponibile');
    const url = page.url();
    if (url.includes('login') || url.includes('auth') || url === `${BASE}/`) {
      test.skip(true, '/settings richiede auth');
    }
    const h1 = page.locator('h1').first();
    await expect(h1).toBeVisible({ timeout: 8000 });
  });

  test('/notifications: H1 visibile (se accessibile)', async ({ page }) => {
    const res = await page.goto(`${BASE}/notifications`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) test.skip(true, '/notifications non disponibile');
    const url = page.url();
    if (url.includes('login') || url.includes('auth') || url === `${BASE}/`) {
      test.skip(true, '/notifications richiede auth');
    }
    const h1 = page.locator('h1').first();
    await expect(h1).toBeVisible({ timeout: 8000 });
  });

  test('/search: risponde con contenuto (non redirect auth)', async ({ page }) => {
    const res = await page.goto(`${BASE}/search`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) test.skip(true, '/search non disponibile');
    const url = page.url();
    if (url.includes('login') || url.includes('auth') || url === `${BASE}/`) {
      test.skip(true, '/search richiede auth');
    }
    const htmlLen = (await page.content()).length;
    expect(htmlLen, '/search pagina vuota').toBeGreaterThan(2000);
  });

  test('pagine tools: title non vuoto', async ({ request }) => {
    const missing: string[] = [];
    for (const { path, label } of TOOLS_PAGES) {
      const res = await request.get(`${BASE}${path}`, { timeout: 8000 }).catch(() => null);
      if (!res || res.status() !== 200) continue;
      const html = await res.text();
      const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
      if (!titleMatch || titleMatch[1].trim().length < 3) missing.push(label);
    }
    if (missing.length > 0) console.log(`[WARN] Title vuoto su: ${missing.join(', ')}`);
    expect(missing.length).toBeLessThan(3);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4 — Sicurezza settings + PWA manifest (ora deployato)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Sicurezza settings + PWA manifest', () => {

  test('/manifest.json: risponde 200', async ({ request }) => {
    const res = await request.get(`${BASE}/manifest.json`);
    if (res.status() === 404) test.skip(true, '/manifest.json non ancora deployato');
    expect(res.status()).toBe(200);
  });

  test('/manifest.json: struttura PWA valida', async ({ request }) => {
    const res = await request.get(`${BASE}/manifest.json`);
    if (res.status() !== 200) test.skip(true, '/manifest.json non disponibile');
    const body = await res.json().catch(() => null);
    expect(body).not.toBeNull();
    expect(body).toHaveProperty('name');
    const hasDisplay = 'display' in body || 'start_url' in body;
    expect(hasDisplay, 'manifest.json: manca display o start_url').toBe(true);
  });

  test('/manifest.json: no dati sensibili', async ({ request }) => {
    const res = await request.get(`${BASE}/manifest.json`);
    if (res.status() !== 200) test.skip(true, '/manifest.json non disponibile');
    const text = await res.text();
    expect(text).not.toMatch(/sk-ant-|password|secret/i);
    expect(text).not.toMatch(/\/home\/\w+\/|\/Users\/\w+\//);
  });

  test('path traversal su /api/notifications: no 500', async ({ request }) => {
    const res = await request.get(`${BASE}/api/notifications?user=../../../etc/passwd`).catch(() => null);
    if (!res || res.status() === 404) test.skip(true, '/api/notifications non disponibile');
    expect(res.status()).not.toBe(500);
    const text = await res.text();
    expect(text).not.toMatch(/root:x:0:0/);
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
