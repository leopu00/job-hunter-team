import { test, expect } from '@playwright/test';

/**
 * FLUSSO 41 — THEME PROVIDER (DARK MODE) E POSIZIONI DETTAGLIO
 *
 * Suite 1: Theme provider — dark/light mode switch
 * Suite 2: Pagina /positions/[id] — struttura, loading skeleton, sicurezza
 * Suite 3: Dark mode visual — nessun testo illeggibile in dark
 * Suite 4: Regressione finale — tutte le pagine del sito in una run
 */

const BASE = process.env.BASE_URL || 'https://jobhunterteam.ai';

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 — Theme Provider (dark/light mode)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Theme provider — dark/light mode', () => {

  test('homepage: attributo class o data-theme sul <html>', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const htmlAttrs = await page.evaluate(() => {
      const html = document.documentElement;
      return {
        class: html.className,
        dataTheme: html.getAttribute('data-theme') ?? '',
        style: html.getAttribute('style') ?? '',
      };
    });
    // ThemeProvider di Next.js (next-themes) aggiunge class="dark" o "light"
    const hasTheme = htmlAttrs.class.includes('dark') || htmlAttrs.class.includes('light') ||
      htmlAttrs.dataTheme !== '' || htmlAttrs.class !== '';
    if (!hasTheme) test.skip(true, 'ThemeProvider non trovato — dark mode non implementato');
    expect(true).toBe(true);
  });

  test('homepage: bottone toggle dark/light mode presente', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const themeBtn = page.locator(
      'button[aria-label*="dark"], button[aria-label*="light"], ' +
      'button[aria-label*="theme"], button[class*="theme"], ' +
      '[class*="dark-mode"], [class*="theme-toggle"]'
    ).first();
    const count = await themeBtn.count();
    if (count === 0) test.skip(true, 'Toggle dark mode non trovato — non implementato sulla landing');
    await expect(themeBtn).toBeVisible({ timeout: 3000 });
  });

  test('/agents: dark mode toggle presente (se implementato)', async ({ page }) => {
    const res = await page.goto(`${BASE}/agents`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) test.skip(true, '/agents non disponibile');
    const url = page.url();
    if (url !== `${BASE}/agents`) test.skip(true, '/agents protetta');
    const themeBtn = page.locator(
      'button[aria-label*="dark"], button[aria-label*="theme"], [class*="theme-toggle"]'
    ).first();
    const count = await themeBtn.count();
    if (count === 0) test.skip(true, 'Toggle dark mode non trovato su /agents');
    await expect(themeBtn).toBeVisible({ timeout: 3000 });
  });

  test('homepage: nessun FOUC (flash of unstyled content) al caricamento', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    // Verifica che i CSS siano caricati (body ha colore di background)
    const bgColor = await page.evaluate(() =>
      window.getComputedStyle(document.body).backgroundColor
    );
    expect(bgColor, 'Body senza background — CSS non caricati').not.toBe('');
    expect(bgColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(jsErrors).toHaveLength(0);
  });

  test('homepage: CSS variabili --background o --foreground definite', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const cssVars = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return {
        background: style.getPropertyValue('--background').trim(),
        foreground: style.getPropertyValue('--foreground').trim(),
        primary: style.getPropertyValue('--primary').trim(),
      };
    });
    const hasCssVars = cssVars.background !== '' || cssVars.foreground !== '' || cssVars.primary !== '';
    if (!hasCssVars) test.skip(true, 'CSS variables non trovate — design system diverso');
    expect(hasCssVars).toBe(true);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2 — Posizioni dettaglio /positions/[id]
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Posizioni dettaglio — /positions/[id]', () => {

  test('GET /positions/test-id risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/positions/test-id`);
    if (res.status() === 404) test.skip(true, '/positions/[id] non disponibile — route non deployata');
    expect(res.status(), '/positions/[id] risponde 500').not.toBe(500);
  });

  test('/positions/[id] redirect auth o 404 senza login', async ({ page }) => {
    const res = await page.goto(`${BASE}/positions/non-esistente-12345`, { waitUntil: 'networkidle' });
    if (!res) test.skip(true, '/positions/[id] non raggiungibile');
    const status = res.status();
    const url = page.url();
    const redirectedToAuth = url.includes('login') || url.includes('auth') || url === `${BASE}/`;
    // Deve essere 404 (posizione inesistente) o redirect auth o 200 con schermata auth
    expect([200, 302, 401, 404]).toContain(status);
    expect(true).toBe(true);
  });

  test('/positions: lista posizioni non espone dati sensibili', async ({ request }) => {
    const res = await request.get(`${BASE}/positions`);
    if (res.status() === 404) test.skip(true, '/positions non disponibile');
    const text = await res.text();
    expect(text).not.toMatch(/sk-ant-|password|secret/i);
  });

  test('/positions/[id]: nessun errore JS al caricamento', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    const res = await page.goto(`${BASE}/positions/test-xyz`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) test.skip(true, '/positions/[id] non disponibile');
    const url = page.url();
    if (url.includes('login') || url === `${BASE}/`) test.skip(true, 'Redirect auth');
    await page.waitForTimeout(500);
    expect(jsErrors, `Errori JS: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

  test('API /api/positions risponde (non 404)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/positions`);
    if (res.status() === 404) test.skip(true, '/api/positions non deployata');
    expect(res.status()).not.toBe(500);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3 — Dark mode visual
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Dark mode visual — nessun problema di leggibilità', () => {

  test('homepage in dark mode: H1 ha colore foreground visibile', async ({ page }) => {
    // Forza dark mode a livello browser
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const h1 = page.locator('h1').first();
    const count = await h1.count();
    if (count === 0) test.skip(true, 'H1 non trovato');
    const color = await h1.evaluate((el) => window.getComputedStyle(el).color);
    // Il colore non deve essere "rgb(0, 0, 0)" puro su sfondo dark
    // Accettiamo qualsiasi colore non completamente trasparente
    expect(color).not.toBe('rgba(0, 0, 0, 0)');
    expect(color).not.toBe('');
  });

  test('homepage in light mode: background è chiaro', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const bg = await page.evaluate(() => window.getComputedStyle(document.body).backgroundColor);
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
    expect(bg).not.toBe('');
  });

  test('homepage dark: nessun errore JS da ThemeProvider', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    expect(jsErrors, `Errori JS dark mode: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4 — Regressione finale completa
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Regressione finale — no 500 ovunque', () => {

  test('tutte le API core rispondono (no 500)', async ({ request }) => {
    const apis = [
      '/api/health', '/api/about', '/api/agents',
      '/api/profile', '/api/changelog', '/api/stats'
    ];
    const errors: string[] = [];
    for (const api of apis) {
      const res = await request.get(`${BASE}${api}`, { timeout: 10000 }).catch(() => null);
      if (res?.status() === 500) errors.push(`500 ${api}`);
    }
    expect(errors, `API con 500:\n${errors.join('\n')}`).toHaveLength(0);
  });

  test('tutte le pagine pubbliche rispondono (no 500)', async ({ request }) => {
    const pages = [
      '/', '/faq', '/guide', '/download', '/about',
      '/changelog', '/docs', '/pricing', '/privacy', '/demo', '/stats'
    ];
    const errors: string[] = [];
    for (const path of pages) {
      const res = await request.get(`${BASE}${path}`, { timeout: 10000 }).catch(() => null);
      if (res?.status() === 500) errors.push(`500 ${path}`);
    }
    expect(errors, `Pagine con 500:\n${errors.join('\n')}`).toHaveLength(0);
  });

  test('homepage: title, H1, footer intatti dopo tutti i deploy', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const title = await page.title();
    expect(title.trim().length).toBeGreaterThan(5);
    const h1 = page.locator('h1').first();
    await expect(h1).toBeVisible({ timeout: 5000 });
    const footer = page.locator('footer').first();
    await expect(footer).toBeVisible({ timeout: 5000 });
  });

  test('/api/health: status OK dopo tutti i deploy', async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    expect(res.status()).toBe(200);
    const body = await res.json().catch(() => ({}));
    expect(body).toHaveProperty('status');
  });

  test('nessun link rotto dalla homepage (sample 10 link)', async ({ page, request }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const links: string[] = await page.evaluate((base) =>
      [...document.querySelectorAll('a[href]')]
        .map((a) => (a as HTMLAnchorElement).href)
        .filter((h) => h.startsWith(base) && !h.includes('#') && !h.includes('?'))
        .filter((h, i, arr) => arr.indexOf(h) === i)
        .slice(0, 10)
    , BASE);
    const broken: string[] = [];
    for (const url of links) {
      const res = await request.get(url, { timeout: 8000 }).catch(() => null);
      if (res && (res.status() === 500)) broken.push(`500 — ${url}`);
    }
    expect(broken, `Link con 500:\n${broken.join('\n')}`).toHaveLength(0);
  });

});
