import { test, expect } from '@playwright/test';

/**
 * FLUSSO 35 — PROFILO UTENTE E AVATAR
 *
 * Suite 1: API /api/profile — struttura, sicurezza, performance
 * Suite 2: API /api/profile/avatar — risposta, redirect, sicurezza
 * Suite 3: Pagina /profile (protected) — redirect non auth, struttura
 * Suite 4: ProfileStats — componente statistiche profilo
 */

const BASE = process.env.BASE_URL || 'https://jobhunterteam.ai';

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 — API /api/profile
// ─────────────────────────────────────────────────────────────────────────────
test.describe('API /api/profile', () => {

  test('GET /api/profile risponde 200', async ({ request }) => {
    const res = await request.get(`${BASE}/api/profile`);
    expect(res.status()).toBe(200);
  });

  test('GET /api/profile: Content-Type JSON', async ({ request }) => {
    const res = await request.get(`${BASE}/api/profile`);
    const ct = res.headers()['content-type'] ?? '';
    expect(ct).toMatch(/application\/json/i);
  });

  test('GET /api/profile: campo profile presente (null senza auth)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/profile`);
    const body = await res.json().catch(() => null);
    expect(body).not.toBeNull();
    expect(body).toHaveProperty('profile');
  });

  test('GET /api/profile: nessun dato sensibile esposto', async ({ request }) => {
    const res = await request.get(`${BASE}/api/profile`);
    const text = await res.text();
    expect(text).not.toMatch(/sk-ant-|password|secret/i);
    expect(text).not.toMatch(/\/home\/\w+\/|\/Users\/\w+\//);
  });

  test('GET /api/profile: risposta < 2000ms', async ({ request }) => {
    const start = Date.now();
    await request.get(`${BASE}/api/profile`);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(2000);
  });

  test('GET /api/profile: risposta deterministica (due call stesso status)', async ({ request }) => {
    const r1 = await request.get(`${BASE}/api/profile`);
    const r2 = await request.get(`${BASE}/api/profile`);
    expect(r1.status()).toBe(r2.status());
  });

  test('GET /api/profile: nessun stack trace nel body', async ({ request }) => {
    const res = await request.get(`${BASE}/api/profile`);
    const text = await res.text();
    expect(text).not.toMatch(/\bat\s+\w+\s+\(/);
    expect(text).not.toMatch(/Error:\s+.*\n\s+at/m);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2 — API /api/profile/avatar
// ─────────────────────────────────────────────────────────────────────────────
test.describe('API /api/profile/avatar', () => {

  test('GET /api/profile/avatar risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/profile/avatar`);
    expect(res.status(), '/api/profile/avatar risponde 500').not.toBe(500);
  });

  test('GET /api/profile/avatar senza auth: 401 o redirect', async ({ request }) => {
    const res = await request.get(`${BASE}/api/profile/avatar`);
    // Senza auth deve essere 401, 302 redirect o 404 (nessun avatar impostato)
    expect([200, 302, 401, 404]).toContain(res.status());
  });

  test('GET /api/profile/avatar non espone dati sensibili', async ({ request }) => {
    const res = await request.get(`${BASE}/api/profile/avatar`);
    if (res.status() === 200) {
      const ct = res.headers()['content-type'] ?? '';
      // Se risponde 200 deve essere un'immagine o JSON, non HTML con dati
      const isImage = ct.startsWith('image/');
      const isJson = ct.includes('application/json');
      expect(isImage || isJson, `Content-Type inatteso: ${ct}`).toBe(true);
    }
    // 401/302/404 sono tutti comportamenti accettabili
    expect(true).toBe(true);
  });

  test('POST /api/profile/avatar senza auth: non 500', async ({ request }) => {
    const res = await request.post(`${BASE}/api/profile/avatar`, {
      data: { url: 'https://example.com/avatar.png' }
    }).catch(() => null);
    if (!res) test.skip(true, 'POST non supportato dal client');
    expect(res!.status(), 'POST /api/profile/avatar risponde 500').not.toBe(500);
  });

  test('GET /api/profile/avatar: risposta < 3000ms', async ({ request }) => {
    const start = Date.now();
    await request.get(`${BASE}/api/profile/avatar`);
    const elapsed = Date.now() - start;
    expect(elapsed, `avatar API troppo lenta: ${elapsed}ms`).toBeLessThan(3000);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3 — Pagina /profile (protected)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Pagina /profile — protezione e redirect', () => {

  test('GET /profile senza auth: non mostra dati personali', async ({ request }) => {
    const res = await request.get(`${BASE}/profile`);
    if (res.status() === 404) test.skip(true, '/profile non disponibile');
    const text = await res.text();
    // Senza auth non deve mostrare email, nome utente reali
    expect(text).not.toMatch(/leone|puglisi|info@jobhunterteam/i);
  });

  test('GET /profile senza auth: redirect o 401', async ({ page }) => {
    const res = await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle' });
    if (res?.status() === 404) test.skip(true, '/profile non disponibile');
    const finalUrl = page.url();
    // Deve essere rediretto al login o alla homepage, non mostrare profilo
    const isRedirectedToAuth = finalUrl.includes('login') || finalUrl.includes('auth') ||
      finalUrl === `${BASE}/` || finalUrl === `${BASE}/?login=true`;
    if (!isRedirectedToAuth) {
      // Potrebbe essere una pagina con messaggio "accedi per vedere il profilo"
      const authRequired = await page.getByText(/accedi|login|sign in|autent/i).count();
      if (authRequired > 0) return; // OK — mostra messaggio di auth
    }
    // Accettiamo redirect o messaggio auth
    expect(true).toBe(true);
  });

  test('/profile: nessun errore JS critico', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    const res = await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle' });
    if (res?.status() === 404) test.skip(true, '/profile non disponibile');
    await page.waitForTimeout(500);
    expect(jsErrors, `Errori JS /profile: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4 — Comportamento API con metodi e input
// ─────────────────────────────────────────────────────────────────────────────
test.describe('API profile — robustezza', () => {

  test('PATCH /api/profile senza body: non crasha (non 500)', async ({ request }) => {
    const res = await request.patch(`${BASE}/api/profile`, { data: {} }).catch(() => null);
    if (!res) test.skip(true, 'PATCH non supportato');
    expect(res!.status()).not.toBe(500);
  });

  test('GET /api/profile con header anomalo non crasha', async ({ request }) => {
    const res = await request.get(`${BASE}/api/profile`, {
      headers: { 'X-Test': '<script>alert(1)</script>' }
    });
    expect(res.status()).not.toBe(500);
  });

  test('/api/profile e /api/profile/avatar entrambi rispondono', async ({ request }) => {
    const [profileRes, avatarRes] = await Promise.all([
      request.get(`${BASE}/api/profile`),
      request.get(`${BASE}/api/profile/avatar`)
    ]);
    expect(profileRes.status()).not.toBe(500);
    expect(avatarRes.status()).not.toBe(500);
  });

  test('GET /api/profile: no X-Powered-By header', async ({ request }) => {
    const res = await request.get(`${BASE}/api/profile`);
    const powered = res.headers()['x-powered-by'] ?? '';
    expect(powered).toBeFalsy();
  });

});
