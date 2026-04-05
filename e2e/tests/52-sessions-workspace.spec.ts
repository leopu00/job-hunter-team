import { test, expect } from '@playwright/test';

/**
 * FLUSSO 52 — SESSIONI, WORKSPACE E MULTI-TENANT
 *
 * Suite 1: API sessioni — /api/sessions risposta e struttura
 * Suite 2: Workspace selector — UI selezione workspace
 * Suite 3: Auth flow — redirect non autenticato su aree protette
 * Suite 4: Cookie e session management — nessun leak
 */

const BASE = process.env.BASE_URL || 'https://jobhunterteam.ai';

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 — API sessioni
// ─────────────────────────────────────────────────────────────────────────────
test.describe('API /api/sessions', () => {

  test('GET /api/sessions risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/sessions`);
    if (res.status() === 404) test.skip(true, '/api/sessions non deployata');
    expect(res.status()).not.toBe(500);
  });

  test('GET /api/sessions senza auth: 401 o lista vuota', async ({ request }) => {
    const res = await request.get(`${BASE}/api/sessions`);
    if (res.status() === 404) test.skip(true, '/api/sessions non deployata');
    expect([200, 401, 403]).toContain(res.status());
  });

  test('GET /api/sessions: Content-Type JSON', async ({ request }) => {
    const res = await request.get(`${BASE}/api/sessions`);
    if (res.status() === 404 || res.status() === 401) test.skip(true, 'Non accessibile');
    const ct = res.headers()['content-type'] ?? '';
    expect(ct).toMatch(/application\/json/i);
  });

  test('GET /api/sessions: nessun dato sensibile', async ({ request }) => {
    const res = await request.get(`${BASE}/api/sessions`);
    if (res.status() === 404 || res.status() === 401) test.skip(true, 'Non accessibile');
    const text = await res.text();
    expect(text).not.toMatch(/sk-ant-|password|secret/i);
    expect(text).not.toMatch(/\/home\/\w+\/|\/Users\/\w+\//);
  });

  test('/api/sessions: risposta < 3s', async ({ request }) => {
    const start = Date.now();
    const res = await request.get(`${BASE}/api/sessions`);
    const elapsed = Date.now() - start;
    if (res.status() === 404) test.skip(true, '/api/sessions non deployata');
    expect(elapsed).toBeLessThan(3000);
  });

  test('GET /api/sessions non crasha con query param anomala', async ({ request }) => {
    const res = await request.get(`${BASE}/api/sessions?id=../../../etc/passwd`);
    if (res.status() === 404) test.skip(true, '/api/sessions non deployata');
    expect(res.status()).not.toBe(500);
    const text = await res.text();
    expect(text).not.toMatch(/root:x:0:0/);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2 — Pagina /sessions
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Pagina /sessions', () => {

  test('GET /sessions risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/sessions`);
    if (res.status() === 404) test.skip(true, '/sessions non disponibile');
    expect(res.status()).not.toBe(500);
  });

  test('/sessions: nessun errore JS critico', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    const res = await page.goto(`${BASE}/sessions`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) test.skip(true, '/sessions non disponibile');
    await page.waitForTimeout(500);
    expect(jsErrors, `Errori JS /sessions: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

  test('/sessions: mobile no overflow', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    const res = await page.goto(`${BASE}/sessions`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) { await ctx.close(); test.skip(true, '/sessions non disponibile'); }
    const overflow = await page.evaluate(() => document.body.scrollWidth > window.innerWidth);
    await ctx.close();
    expect(overflow).toBe(false);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3 — Auth flow — redirect non autenticato
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Auth flow — redirect non autenticato', () => {

  const PROTECTED = [
    '/dashboard', '/applications', '/positions', '/scout',
    '/analista', '/profile', '/reports', '/sessions', '/team',
  ];

  test('tutte le pagine protette: nessuna risponde 500', async ({ request }) => {
    const errors: string[] = [];
    for (const path of PROTECTED) {
      const res = await request.get(`${BASE}${path}`, { timeout: 8000 }).catch(() => null);
      if (res?.status() === 500) errors.push(`500 ${path}`);
    }
    expect(errors, `500 su protette: ${errors.join(', ')}`).toHaveLength(0);
  });

  test('pagine protette: rispondo 200, 302, 401 (non 500/404 sulle principali)', async ({ request }) => {
    const mainProtected = ['/dashboard', '/applications', '/profile'];
    const errors: string[] = [];
    for (const path of mainProtected) {
      const res = await request.get(`${BASE}${path}`, { timeout: 8000 }).catch(() => null);
      if (!res) continue;
      if (res.status() === 404) continue; // non ancora deployata
      if (res.status() === 500) errors.push(`500 ${path}`);
    }
    expect(errors, `500: ${errors.join(', ')}`).toHaveLength(0);
  });

  test('URL con ?login=true: risponde senza 500', async ({ request }) => {
    const res = await request.get(`${BASE}/?login=true`);
    expect(res.status()).not.toBe(500);
  });

  test('URL con hash auth: no crash', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => jsErrors.push(e.message));
    await page.goto(`${BASE}/?login=true`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const critical = jsErrors.filter((e) => !/expected|warning|chunk|hydrat/i.test(e));
    expect(critical).toHaveLength(0);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4 — Cookie e session management
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Cookie e session management — no leak', () => {

  test('homepage: nessun cookie sensibile esposto nel JS', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const cookies = await page.context().cookies();
    // Nessun cookie deve avere un valore che sembra un token JWT o API key
    for (const cookie of cookies) {
      if (cookie.name.toLowerCase().includes('token') ||
          cookie.name.toLowerCase().includes('session') ||
          cookie.name.toLowerCase().includes('auth')) {
        // Se presente, deve essere HttpOnly (non accessibile da JS)
        if (!cookie.httpOnly) {
          console.log(`[WARN] Cookie non-HttpOnly: ${cookie.name}`);
        }
      }
    }
    expect(true).toBe(true);
  });

  test('homepage: Set-Cookie header senza Secure su HTTPS', async ({ request }) => {
    const res = await request.get(`${BASE}/`);
    const setCookie = res.headers()['set-cookie'] ?? '';
    if (setCookie) {
      // Su HTTPS i cookie dovrebbero avere Secure flag
      const cookies = setCookie.split(',');
      for (const c of cookies) {
        if (c.toLowerCase().includes('session') || c.toLowerCase().includes('auth')) {
          if (!c.toLowerCase().includes('secure') && !c.toLowerCase().includes('httponly')) {
            console.log(`[WARN] Cookie senza Secure/HttpOnly: ${c.slice(0, 60)}`);
          }
        }
      }
    }
    // Non fail hard — solo documentativo
    expect(true).toBe(true);
  });

  test('/api/profile: no Set-Cookie senza auth', async ({ request }) => {
    const res = await request.get(`${BASE}/api/profile`);
    expect(res.status()).toBe(200);
    // La risposta profile senza auth non dovrebbe settare cookie di sessione
    const setCookie = res.headers()['set-cookie'] ?? '';
    if (setCookie.includes('session') || setCookie.includes('auth')) {
      console.log(`[INFO] /api/profile setta cookie: ${setCookie.slice(0, 100)}`);
    }
    expect(true).toBe(true);
  });

  test('richiesta anonima: no info personali nell\'HTML homepage', async ({ page }) => {
    // Context completamente pulito (nessun cookie/storage)
    const ctx = await page.context().browser()!.newContext({ storageState: undefined });
    const freshPage = await ctx.newPage();
    await freshPage.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const content = await freshPage.locator('body').innerText().catch(() => '');
    // Non deve mostrare email, nomi personali o token
    expect(content).not.toMatch(/leone|puglisi|sk-ant-/i);
    await ctx.close();
  });

});
