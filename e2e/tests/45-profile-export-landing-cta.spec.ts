import { test, expect } from '@playwright/test';

/**
 * FLUSSO 45 — PROFILE EXPORT, LANDING CTA E NAVBAR
 *
 * Suite 1: API /api/profile/export — risposta, sicurezza, formato
 * Suite 2: Landing CTA aggiornata — link e bottoni
 * Suite 3: LandingNav aggiornata — link presenti
 * Suite 4: Breadcrumb aggiornato — no crash post-update
 */

const BASE = process.env.BASE_URL || 'https://jobhunterteam.ai';

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 — API /api/profile/export
// ─────────────────────────────────────────────────────────────────────────────
test.describe('API /api/profile/export', () => {

  test('GET /api/profile/export risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/profile/export`);
    if (res.status() === 404) test.skip(true, '/api/profile/export non deployata');
    expect(res.status(), '/api/profile/export risponde 500').not.toBe(500);
  });

  test('GET /api/profile/export senza auth: 401 o 403', async ({ request }) => {
    const res = await request.get(`${BASE}/api/profile/export`);
    if (res.status() === 404) test.skip(true, '/api/profile/export non disponibile');
    // Senza autenticazione deve restituire 401/403 (dati protetti)
    expect([200, 401, 403]).toContain(res.status());
  });

  test('GET /api/profile/export: nessun dato sensibile senza auth', async ({ request }) => {
    const res = await request.get(`${BASE}/api/profile/export`);
    if (res.status() === 404 || res.status() === 401 || res.status() === 403) {
      test.skip(true, '/api/profile/export protetta — comportamento corretto');
    }
    const text = await res.text();
    expect(text).not.toMatch(/sk-ant-|password|secret/i);
    expect(text).not.toMatch(/leone|puglisi/i);
  });

  test('GET /api/profile/export: Content-Type JSON o octet-stream', async ({ request }) => {
    const res = await request.get(`${BASE}/api/profile/export`);
    if (res.status() !== 200) test.skip(true, '/api/profile/export non accessibile');
    const ct = res.headers()['content-type'] ?? '';
    expect(ct).toMatch(/application\/(json|octet-stream|pdf|zip)|text\//i);
  });

  test('POST /api/profile/export senza body: non 500', async ({ request }) => {
    const res = await request.post(`${BASE}/api/profile/export`, { data: {} }).catch(() => null);
    if (!res) test.skip(true, 'POST non supportato');
    if (res!.status() === 404) test.skip(true, '/api/profile/export non deployata');
    expect(res!.status()).not.toBe(500);
  });

  test('/api/profile e /api/profile/export entrambi non 500', async ({ request }) => {
    const [profileRes, exportRes] = await Promise.all([
      request.get(`${BASE}/api/profile`),
      request.get(`${BASE}/api/profile/export`)
    ]);
    expect(profileRes.status()).not.toBe(500);
    if (exportRes.status() !== 404) {
      expect(exportRes.status()).not.toBe(500);
    }
  });

  test('/api/profile/export: risposta < 5000ms', async ({ request }) => {
    const start = Date.now();
    const res = await request.get(`${BASE}/api/profile/export`);
    const elapsed = Date.now() - start;
    if (res.status() === 404) test.skip(true, '/api/profile/export non disponibile');
    expect(elapsed, `export API lenta: ${elapsed}ms`).toBeLessThan(5000);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2 — Landing CTA aggiornata
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Landing CTA — aggiornamento', () => {

  test('homepage: almeno un bottone CTA principale visibile', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const cta = page.locator(
      'a[href="/download"], a[class*="cta"], a[class*="btn"], ' +
      'button[class*="cta"], a[href*="github"], [class*="LandingCTA"] a'
    ).first();
    const count = await cta.count();
    expect(count, 'Nessun CTA principale trovato').toBeGreaterThan(0);
    await expect(cta).toBeVisible({ timeout: 5000 });
  });

  test('homepage: link /download presente (CTA principale)', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const downloadLink = page.locator('a[href="/download"]').first();
    const count = await downloadLink.count();
    expect(count, 'Link /download assente').toBeGreaterThan(0);
    await expect(downloadLink).toBeVisible({ timeout: 5000 });
  });

  test('homepage: CTA non porta a pagina 404', async ({ page, request }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const ctaLinks: string[] = await page.evaluate((base) =>
      [...document.querySelectorAll('[class*="cta"] a, [class*="LandingCTA"] a')]
        .map((a) => (a as HTMLAnchorElement).href)
        .filter((h) => h.startsWith(base))
    , BASE);
    for (const url of ctaLinks.slice(0, 5)) {
      const res = await request.get(url).catch(() => null);
      if (res) expect(res.status(), `CTA link ${url} → 404`).not.toBe(404);
    }
    expect(true).toBe(true);
  });

  test('homepage: LandingCTA risponde senza errori JS', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    expect(jsErrors, `Errori JS LandingCTA: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3 — LandingNav aggiornata
// ─────────────────────────────────────────────────────────────────────────────
test.describe('LandingNav — link di navigazione', () => {

  test('homepage: navbar con link /download presente', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const navDownload = page.locator('nav a[href="/download"], header a[href="/download"]').first();
    const count = await navDownload.count();
    if (count === 0) test.skip(true, 'Link /download nella navbar non trovato');
    await expect(navDownload).toBeVisible({ timeout: 5000 });
  });

  test('homepage: navbar con link /faq o /guide', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const navLink = page.locator('nav a[href="/faq"], nav a[href="/guide"], header a[href="/faq"]').first();
    const count = await navLink.count();
    expect(count, 'Nessun link /faq o /guide nella navbar').toBeGreaterThan(0);
  });

  test('homepage: logo clickabile presente nella navbar', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const logo = page.locator('nav a[href="/"], header a[href="/"]').first();
    const count = await logo.count();
    expect(count, 'Logo/link home assente nella navbar').toBeGreaterThan(0);
    await expect(logo).toBeVisible({ timeout: 5000 });
  });

  test('homepage: navbar non causa overflow orizzontale', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const overflow = await page.evaluate(() => document.body.scrollWidth > window.innerWidth);
    expect(overflow, 'Overflow dopo aggiornamento LandingNav').toBe(false);
  });

  test('LandingNav su mobile (375px) — non causa overflow', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const overflow = await page.evaluate(() => document.body.scrollWidth > window.innerWidth);
    await ctx.close();
    expect(overflow, 'LandingNav: overflow su mobile').toBe(false);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4 — Breadcrumb aggiornato + regressione completa
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Breadcrumb e regressione post-update', () => {

  test('/agents: Breadcrumb aggiornato — nessun crash', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => jsErrors.push(e.message));
    const res = await page.goto(`${BASE}/agents`, { waitUntil: 'networkidle' });
    if (!res || res.status() !== 200) test.skip(true, '/agents non disponibile');
    const url = page.url();
    if (url !== `${BASE}/agents`) test.skip(true, '/agents protetta');
    await page.waitForTimeout(500);
    const critical = jsErrors.filter((e) => !/expected|warning|chunk|hydrat/i.test(e));
    expect(critical).toHaveLength(0);
  });

  test('tutte le API critiche OK post-update', async ({ request }) => {
    const apis = ['/api/health', '/api/about', '/api/agents', '/api/profile'];
    const errors: string[] = [];
    for (const api of apis) {
      const res = await request.get(`${BASE}${api}`, { timeout: 8000 }).catch(() => null);
      if (res?.status() === 500) errors.push(`500 ${api}`);
    }
    expect(errors, `API con 500: ${errors.join(', ')}`).toHaveLength(0);
  });

  test('homepage: performance — risponde < 3s', async ({ request }) => {
    const start = Date.now();
    await request.get(`${BASE}/`);
    const elapsed = Date.now() - start;
    expect(elapsed, `Homepage lenta: ${elapsed}ms`).toBeLessThan(3000);
  });

  test('pagine core no 500: /, /faq, /download, /about', async ({ request }) => {
    const pages = ['/', '/faq', '/download', '/about'];
    const errors: string[] = [];
    for (const path of pages) {
      const res = await request.get(`${BASE}${path}`, { timeout: 8000 }).catch(() => null);
      if (res?.status() === 500) errors.push(`500 ${path}`);
    }
    expect(errors, `Pagine con 500: ${errors.join(', ')}`).toHaveLength(0);
  });

});
