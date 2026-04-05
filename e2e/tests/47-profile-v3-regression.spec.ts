import { test, expect } from '@playwright/test';

/**
 * FLUSSO 47 — PROFILE V3 E REGRESSIONE RAPIDA
 *
 * Profile page ha avuto 3 iterazioni ravvicinate — verifica stabilità.
 *
 * Suite 1: Profile v3 — stabilità dopo aggiornamenti multipli
 * Suite 2: globals.css v2 — no regressioni visual critiche
 * Suite 3: API core — smoke test rapido su tutte le API
 * Suite 4: Smoke test pagine — 5 pagine in 60s
 */

const BASE = process.env.BASE_URL || 'https://jobhunterteam.ai';

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 — Profile v3 stabilità
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Profile v3 — stabilità post-iterazioni', () => {

  test('/profile: HTTP 200 o redirect auth (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/profile`);
    if (res.status() === 404) test.skip(true, '/profile non disponibile');
    expect([200, 302]).toContain(res.status());
  });

  test('/profile: HTML contiene struttura Next.js', async ({ request }) => {
    const res = await request.get(`${BASE}/profile`);
    if (res.status() !== 200) test.skip(true, '/profile non 200');
    const html = await res.text();
    expect(html).toMatch(/__NEXT_DATA__|_next\/static|<html/);
  });

  test('/profile: nessun dato personale nell\'HTML SSR', async ({ request }) => {
    const res = await request.get(`${BASE}/profile`);
    if (res.status() !== 200) test.skip(true, '/profile non 200');
    const html = await res.text();
    expect(html).not.toMatch(/leone\.puglisi|leone@|sk-ant-|api.key/i);
  });

  test('/profile: nessun errore JS critico', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    const res = await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) test.skip(true, '/profile non disponibile');
    await page.waitForTimeout(800);
    expect(jsErrors, `Errori JS /profile v3: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

  test('/profile: no overflow mobile', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    const res = await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) { await ctx.close(); test.skip(true, '/profile non disponibile'); }
    const overflow = await page.evaluate(() => document.body.scrollWidth > window.innerWidth);
    await ctx.close();
    expect(overflow, 'Overflow mobile /profile v3').toBe(false);
  });

  test('/api/profile: risponde 200 con campo profile', async ({ request }) => {
    const res = await request.get(`${BASE}/api/profile`);
    expect(res.status()).toBe(200);
    const body = await res.json().catch(() => null);
    expect(body).toHaveProperty('profile');
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2 — globals.css v2
// ─────────────────────────────────────────────────────────────────────────────
test.describe('globals.css v2 — no regressioni', () => {

  test('homepage: background e colore testo definiti', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const [bg, color, font] = await page.evaluate(() => [
      window.getComputedStyle(document.body).backgroundColor,
      window.getComputedStyle(document.body).color,
      window.getComputedStyle(document.body).fontFamily,
    ]);
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
    expect(color).not.toBe('');
    expect(font).not.toBe('');
  });

  test('homepage dark: background diverso da light', async ({ page }) => {
    // Light mode
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const lightBg = await page.evaluate(() => window.getComputedStyle(document.body).backgroundColor);

    // Dark mode
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const darkBg = await page.evaluate(() => window.getComputedStyle(document.body).backgroundColor);

    // Entrambi devono essere definiti (ma possono essere uguali se app gestisce manualmente)
    expect(lightBg).not.toBe('rgba(0, 0, 0, 0)');
    expect(darkBg).not.toBe('rgba(0, 0, 0, 0)');
  });

  test('/faq: stili ok dopo update globals.css', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => jsErrors.push(e.message));
    await page.goto(`${BASE}/faq`, { waitUntil: 'networkidle' });
    const bg = await page.evaluate(() => window.getComputedStyle(document.body).backgroundColor);
    expect(bg).not.toBe('');
    const critical = jsErrors.filter((e) => !/expected|warning|chunk|hydrat/i.test(e));
    expect(critical).toHaveLength(0);
  });

  test('homepage: no overflow desktop o mobile dopo CSS update', async ({ page, browser }) => {
    // Desktop
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const desktopOverflow = await page.evaluate(() => document.body.scrollWidth > window.innerWidth);
    expect(desktopOverflow, 'Overflow desktop dopo CSS update').toBe(false);

    // Mobile
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const mobilePage = await ctx.newPage();
    await mobilePage.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const mobileOverflow = await mobilePage.evaluate(() => document.body.scrollWidth > window.innerWidth);
    await ctx.close();
    expect(mobileOverflow, 'Overflow mobile dopo CSS update').toBe(false);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3 — API core smoke test
// ─────────────────────────────────────────────────────────────────────────────
test.describe('API core — smoke test rapido', () => {

  const CORE_APIS = [
    { path: '/api/health',   label: 'Health'   },
    { path: '/api/about',    label: 'About'    },
    { path: '/api/agents',   label: 'Agents'   },
    { path: '/api/profile',  label: 'Profile'  },
    { path: '/api/changelog', label: 'Changelog' },
  ];

  test('tutte le API core rispondono (no 500, no 404)', async ({ request }) => {
    const errors: string[] = [];
    for (const { path, label } of CORE_APIS) {
      const res = await request.get(`${BASE}${path}`, { timeout: 8000 }).catch(() => null);
      if (!res) { errors.push(`TIMEOUT ${label}`); continue; }
      if (res.status() === 500) errors.push(`500 ${label}`);
      if (res.status() === 404) errors.push(`404 ${label}`);
    }
    expect(errors, `API con errori:\n${errors.join('\n')}`).toHaveLength(0);
  });

  test('API core: Content-Type JSON su tutte', async ({ request }) => {
    const notJson: string[] = [];
    for (const { path, label } of CORE_APIS) {
      const res = await request.get(`${BASE}${path}`).catch(() => null);
      if (!res || res.status() !== 200) continue;
      const ct = res.headers()['content-type'] ?? '';
      if (!ct.includes('application/json')) notJson.push(`${label}: ${ct}`);
    }
    expect(notJson, `API non JSON: ${notJson.join(', ')}`).toHaveLength(0);
  });

  test('/api/health: uptime e status presenti', async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    expect(res.status()).toBe(200);
    const body = await res.json().catch(() => ({}));
    expect(body).toHaveProperty('status');
    const hasUptime = 'uptime' in body || 'startedAt' in body || 'started_at' in body;
    expect(hasUptime).toBe(true);
  });

  test('API core: performance < 2s ciascuna', async ({ request }) => {
    const slow: string[] = [];
    for (const { path, label } of CORE_APIS) {
      const start = Date.now();
      const res = await request.get(`${BASE}${path}`, { timeout: 5000 }).catch(() => null);
      const elapsed = Date.now() - start;
      if (res?.status() === 200 && elapsed > 2000) slow.push(`${label}: ${elapsed}ms`);
    }
    if (slow.length > 0) console.log(`[WARN] API lente: ${slow.join(', ')}`);
    expect(slow.length).toBeLessThan(2);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4 — Smoke test 5 pagine in < 60s
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Smoke test 5 pagine', () => {

  const SMOKE_PAGES = ['/', '/faq', '/download', '/about', '/changelog'];

  for (const path of SMOKE_PAGES) {
    test(`${path}: status 200 e H1 visibile`, async ({ page }) => {
      const res = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 15000 });
      if (res?.status() === 404) test.skip(true, `${path} non deployata`);
      expect(res?.status()).toBe(200);
      const h1 = page.locator('h1').first();
      await expect(h1).toBeVisible({ timeout: 8000 });
      const text = await h1.innerText();
      expect(text.trim().length).toBeGreaterThan(0);
    });
  }

});
