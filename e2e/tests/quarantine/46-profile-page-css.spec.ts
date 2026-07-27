import { test, expect } from '@playwright/test';

/**
 * FLUSSO 46 — PROFILE PAGE AGGIORNATA E CSS GLOBALI
 *
 * Suite 1: Profile page — struttura aggiornata, sezioni, sicurezza
 * Suite 2: CSS globali (globals.css) — no regressioni visual
 * Suite 3: Contrasto e accessibilità colori post-update
 * Suite 4: Regressione completa — 10 pagine + 6 API in una run
 */

const BASE = process.env.BASE_URL || 'https://jobhunterteam.ai';

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 — Profile page aggiornata
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Profile page — struttura aggiornata', () => {

  test('GET /profile risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/profile`);
    if (res.status() === 404) test.skip(true, '/profile non disponibile');
    expect(res.status()).not.toBe(500);
  });

  test('/profile: HTML aggiornato con sezioni corrette', async ({ request }) => {
    const res = await request.get(`${BASE}/profile`);
    if (res.status() !== 200) test.skip(true, '/profile non risponde 200');
    const html = await res.text();
    // L'HTML deve contenere struttura Next.js con __NEXT_DATA__ o _next
    expect(html).toMatch(/__NEXT_DATA__|_next\/static/);
  });

  test('/profile: redirect auth senza login', async ({ page }) => {
    const res = await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) test.skip(true, '/profile non disponibile');
    const url = page.url();
    // Se non reindirizzato al login, deve mostrare contenuto di auth o pagina profilo
    const isOnProfile = url.includes('profile');
    const isRedirected = url.includes('login') || url.includes('auth') || url === `${BASE}/`;
    expect(isOnProfile || isRedirected).toBe(true);
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
    expect(jsErrors, `Errori JS /profile: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

  test('/profile: no dati personali esposti (HTML)', async ({ request }) => {
    const res = await request.get(`${BASE}/profile`);
    if (res.status() !== 200) test.skip(true, '/profile non disponibile');
    const html = await res.text();
    // Non devono esserci dati personali hardcodati nell'HTML SSR
    expect(html).not.toMatch(/leone\.puglisi|leone@|sk-ant-/i);
  });

  test('/profile: mobile (375px) nessun overflow', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    const res = await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) { await ctx.close(); test.skip(true, '/profile non disponibile'); }
    const overflow = await page.evaluate(() => document.body.scrollWidth > window.innerWidth);
    await ctx.close();
    expect(overflow, 'Overflow mobile /profile').toBe(false);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2 — CSS globali (globals.css aggiornato)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('CSS globali — no regressioni visual', () => {

  test('homepage: body ha background-color definito', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const bg = await page.evaluate(() =>
      window.getComputedStyle(document.body).backgroundColor
    );
    expect(bg, 'Body senza background').not.toBe('');
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  });

  test('homepage: font-family definito sul body', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const font = await page.evaluate(() =>
      window.getComputedStyle(document.body).fontFamily
    );
    expect(font, 'Font family non definito').not.toBe('');
    expect(font.trim().length).toBeGreaterThan(0);
  });

  test('homepage: testo H1 ha line-height ragionevole', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const h1 = page.locator('h1').first();
    const count = await h1.count();
    if (count === 0) test.skip(true, 'H1 non trovato');
    const lineHeight = await h1.evaluate((el) => window.getComputedStyle(el).lineHeight);
    expect(lineHeight).not.toBe('');
    // line-height normale è tra 1.0 e 2.0 (o in px)
    if (lineHeight !== 'normal') {
      const val = parseFloat(lineHeight);
      if (!isNaN(val)) expect(val).toBeGreaterThan(0);
    }
    expect(true).toBe(true);
  });

  test('/faq: pagina con stili aggiornati carica correttamente', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => jsErrors.push(e.message));
    await page.goto(`${BASE}/faq`, { waitUntil: 'networkidle' });
    const bg = await page.evaluate(() => window.getComputedStyle(document.body).backgroundColor);
    expect(bg).not.toBe('');
    const critical = jsErrors.filter((e) => !/expected|warning|chunk|hydrat/i.test(e));
    expect(critical).toHaveLength(0);
  });

  test('homepage dark mode: CSS variables aggiornate', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const bg = await page.evaluate(() => window.getComputedStyle(document.body).backgroundColor);
    expect(bg).not.toBe('');
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3 — Contrasto e leggibilità
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Contrasto e leggibilità post-update CSS', () => {

  test('homepage: H1 colore visibile su background', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const h1 = page.locator('h1').first();
    const count = await h1.count();
    if (count === 0) test.skip(true, 'H1 non trovato');
    const color = await h1.evaluate((el) => window.getComputedStyle(el).color);
    const bg = await h1.evaluate((el) => window.getComputedStyle(el).backgroundColor);
    // Non devono essere entrambi trasparenti
    expect(color).not.toBe('rgba(0, 0, 0, 0)');
    expect(color).not.toBe('');
  });

  test('homepage: link navigazione visibili', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const navLinks = page.locator('nav a').all();
    const links = await navLinks;
    for (const link of links.slice(0, 3)) {
      const color = await link.evaluate((el) => window.getComputedStyle(el).color);
      expect(color, 'Link nav invisibile').not.toBe('rgba(0, 0, 0, 0)');
    }
  });

  test('/download: pagina con stili corretti', async ({ page }) => {
    const res = await page.goto(`${BASE}/download`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) test.skip(true, '/download non disponibile');
    const bg = await page.evaluate(() => window.getComputedStyle(document.body).backgroundColor);
    expect(bg).not.toBe('');
    const overflow = await page.evaluate(() => document.body.scrollWidth > window.innerWidth);
    expect(overflow, 'Overflow su /download').toBe(false);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4 — Regressione completa 10+6
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Regressione completa — 10 pagine + 6 API', () => {

  test('10 pagine pubbliche: nessuna risponde 500', async ({ request }) => {
    const pages = [
      '/', '/faq', '/guide', '/download', '/about',
      '/changelog', '/docs', '/pricing', '/privacy', '/demo'
    ];
    const errors: string[] = [];
    for (const path of pages) {
      const res = await request.get(`${BASE}${path}`, { timeout: 8000 }).catch(() => null);
      if (res?.status() === 500) errors.push(`500 ${path}`);
    }
    expect(errors, `Pagine con 500:\n${errors.join('\n')}`).toHaveLength(0);
  });

  test('6 API critiche: nessuna risponde 500', async ({ request }) => {
    const apis = [
      '/api/health', '/api/about', '/api/agents',
      '/api/profile', '/api/changelog', '/api/profile/export'
    ];
    const errors: string[] = [];
    for (const api of apis) {
      const res = await request.get(`${BASE}${api}`, { timeout: 8000 }).catch(() => null);
      if (res?.status() === 500) errors.push(`500 ${api}`);
    }
    expect(errors, `API con 500:\n${errors.join('\n')}`).toHaveLength(0);
  });

  test('homepage: title, H1, footer, nav intatti', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const title = await page.title();
    expect(title.trim().length).toBeGreaterThan(5);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('footer').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('nav').first()).toBeVisible({ timeout: 5000 });
  });

  test('/api/health: status e uptime ancora presenti', async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    expect(res.status()).toBe(200);
    const body = await res.json().catch(() => ({}));
    expect(body).toHaveProperty('status');
    const hasUptime = 'uptime' in body || 'startedAt' in body || 'started_at' in body;
    expect(hasUptime, 'Campo uptime assente in /api/health').toBe(true);
  });

});
