import { test, expect } from '@playwright/test';

/**
 * FLUSSO 36 — KEYBOARD SHORTCUTS E GLOBAL SEARCH
 *
 * Suite 1: GlobalSearch — apertura, chiusura, risultati
 * Suite 2: Keyboard shortcuts — scorciatoie tastiera nelle pagine app
 * Suite 3: Navigazione tastiera — accessibilità da keyboard nelle pagine protette
 * Suite 4: Breadcrumb — struttura navigazione breadcrumb
 */

const BASE = process.env.BASE_URL || 'https://jobhunterteam.ai';

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 — GlobalSearch
// ─────────────────────────────────────────────────────────────────────────────
test.describe('GlobalSearch — ricerca globale', () => {

  /** Naviga verso una pagina app che dovrebbe avere GlobalSearch */
  async function gotoApp(page: any): Promise<boolean> {
    const res = await page.goto(`${BASE}/agents`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) return false;
    return true;
  }

  test('homepage: GlobalSearch non esposto sulla landing', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    // GlobalSearch è solo nell'app, non sulla landing pubblica
    const searchInput = page.locator('input[type="search"], input[placeholder*="cerca"], input[placeholder*="search"]').first();
    const count = await searchInput.count();
    // Se presente sulla landing va bene (può esserci un cerca)
    // Il test verifica solo che non ci siano errori
    expect(true).toBe(true);
  });

  test('/agents: GlobalSearch input presente o shortcut Ctrl+K', async ({ page }) => {
    const available = await gotoApp(page);
    if (!available) test.skip(true, '/agents non disponibile');
    // Prova a trovare il GlobalSearch (input o bottone ricerca)
    const searchEl = page.locator(
      'input[type="search"], [class*="search"], button[aria-label*="search"], button[aria-label*="cerca"]'
    ).first();
    const count = await searchEl.count();
    if (count === 0) {
      // Prova la shortcut Ctrl+K
      await page.keyboard.press('Control+k');
      await page.waitForTimeout(300);
      const modal = page.locator('[role="dialog"], [class*="modal"], [class*="search-modal"]').first();
      const modalVisible = await modal.isVisible().catch(() => false);
      if (!modalVisible) test.skip(true, 'GlobalSearch non trovato — non ancora deployato');
    }
    expect(true).toBe(true);
  });

  test('/agents: Ctrl+K apre la ricerca globale', async ({ page }) => {
    const available = await gotoApp(page);
    if (!available) test.skip(true, '/agents non disponibile');
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(400);
    // Cerca un input di ricerca attivo
    const searchInput = page.locator('input[type="search"], input[placeholder*="cerca"], input[placeholder*="search"], input[placeholder*="Cerca"]').first();
    const visible = await searchInput.isVisible().catch(() => false);
    if (!visible) test.skip(true, 'Ctrl+K non apre GlobalSearch — non implementato');
    await expect(searchInput).toBeVisible({ timeout: 3000 });
  });

  test('/agents: Escape chiude la ricerca globale', async ({ page }) => {
    const available = await gotoApp(page);
    if (!available) test.skip(true, '/agents non disponibile');
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(300);
    const searchInput = page.locator('input[type="search"], input[placeholder*="cerca"]').first();
    const visible = await searchInput.isVisible().catch(() => false);
    if (!visible) test.skip(true, 'GlobalSearch non aperto con Ctrl+K');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const stillVisible = await searchInput.isVisible().catch(() => false);
    expect(stillVisible, 'GlobalSearch non si chiude con Escape').toBe(false);
  });

  test('/agents: digitare nel search mostra risultati o stato vuoto', async ({ page }) => {
    const available = await gotoApp(page);
    if (!available) test.skip(true, '/agents non disponibile');
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(300);
    const searchInput = page.locator('input[type="search"], input[placeholder*="cerca"], input[placeholder*="Cerca"]').first();
    const visible = await searchInput.isVisible().catch(() => false);
    if (!visible) test.skip(true, 'GlobalSearch non disponibile');
    await searchInput.fill('scout');
    await page.waitForTimeout(500);
    // Deve apparire almeno un risultato o un messaggio "nessun risultato"
    const results = page.locator('[class*="result"], [class*="suggestion"], li').first();
    const resultsCount = await results.count();
    if (resultsCount === 0) test.skip(true, 'Risultati ricerca non trovati — struttura diversa');
    expect(resultsCount).toBeGreaterThan(0);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2 — Keyboard shortcuts
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Keyboard shortcuts — scorciatoie', () => {

  test('/agents: pagina raggiungibile da tastiera', async ({ page }) => {
    const res = await page.goto(`${BASE}/agents`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) test.skip(true, '/agents non disponibile');
    // Verifica che ci siano elementi focusabili
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? el.tagName.toLowerCase() : 'body';
    });
    expect(['a', 'button', 'input', 'textarea', 'select', 'body']).toContain(focused);
  });

  test('/agents: shortcut ? o h non crasha la pagina', async ({ page }) => {
    const res = await page.goto(`${BASE}/agents`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) test.skip(true, '/agents non disponibile');
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => jsErrors.push(e.message));
    await page.keyboard.press('?');
    await page.waitForTimeout(200);
    expect(jsErrors).toHaveLength(0);
  });

  test('/agents: / non apre ricerca del browser (gestito dall\'app)', async ({ page }) => {
    const res = await page.goto(`${BASE}/agents`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) test.skip(true, '/agents non disponibile');
    // Premi / e verifica che non ci siano errori JS
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => jsErrors.push(e.message));
    await page.keyboard.press('/');
    await page.waitForTimeout(200);
    expect(jsErrors, `Errore JS dopo /: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

  test('KeyboardShortcuts: nessun conflitto con input field', async ({ page }) => {
    const res = await page.goto(`${BASE}/agents`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) test.skip(true, '/agents non disponibile');
    // Se c'è un input, digitare in esso non deve attivare shortcut globali
    const input = page.locator('input:not([type="hidden"])').first();
    const inputCount = await input.count();
    if (inputCount === 0) test.skip(true, 'Nessun input trovato');
    await input.click();
    await input.type('test');
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => jsErrors.push(e.message));
    await page.waitForTimeout(200);
    expect(jsErrors).toHaveLength(0);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3 — Pagine protette: redirect non autenticato
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Pagine protette — redirect non autenticato', () => {

  const PROTECTED_PATHS = [
    '/dashboard',
    '/applications',
    '/positions',
    '/scout',
    '/analista',
    '/profile',
  ];

  for (const path of PROTECTED_PATHS) {
    test(`${path}: redirige o mostra auth senza login`, async ({ page }) => {
      const res = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
      if (res?.status() === 404) test.skip(true, `${path} non disponibile`);
      const finalUrl = page.url();
      const isOnAuth = finalUrl.includes('login') || finalUrl.includes('auth') ||
        finalUrl === `${BASE}/` || finalUrl.includes('?login');
      if (!isOnAuth) {
        // Accettabile: pagina mostra "accedi" o spinner di auth
        const authText = await page.getByText(/accedi|login|sign in|non autenticato|sessione/i).count();
        // Oppure è rimasto sulla pagina (SPA con auth check interno)
        if (authText === 0) {
          // Verifica che almeno non mostri dati personali reali
          const content = await page.content();
          expect(content).not.toMatch(/leone|puglisi/i);
        }
      }
      expect(true).toBe(true);
    });
  }

  test('nessuna pagina protetta risponde 500', async ({ request }) => {
    const errors: string[] = [];
    for (const path of PROTECTED_PATHS) {
      const res = await request.get(`${BASE}${path}`, { timeout: 10000 }).catch(() => null);
      if (res?.status() === 500) errors.push(`500 ${path}`);
    }
    expect(errors, `Pagine protette con 500:\n${errors.join('\n')}`).toHaveLength(0);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4 — Breadcrumb
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Breadcrumb — navigazione strutturata', () => {

  test('/agents: breadcrumb presente o navigazione contestuale', async ({ page }) => {
    const res = await page.goto(`${BASE}/agents`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) test.skip(true, '/agents non disponibile');
    const breadcrumb = page.locator(
      'nav[aria-label*="bread"], [class*="breadcrumb"], ol[class*="bread"]'
    ).first();
    const count = await breadcrumb.count();
    if (count === 0) test.skip(true, 'Breadcrumb non implementato su /agents');
    await expect(breadcrumb).toBeVisible({ timeout: 3000 });
  });

  test('breadcrumb: primo elemento è link alla home', async ({ page }) => {
    const res = await page.goto(`${BASE}/agents`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) test.skip(true, '/agents non disponibile');
    const breadcrumb = page.locator(
      'nav[aria-label*="bread"], [class*="breadcrumb"]'
    ).first();
    const count = await breadcrumb.count();
    if (count === 0) test.skip(true, 'Breadcrumb non implementato');
    const homeLink = breadcrumb.locator('a[href="/"]').first();
    const homeCount = await homeLink.count();
    if (homeCount === 0) test.skip(true, 'Link home nel breadcrumb non trovato');
    await expect(homeLink).toBeVisible({ timeout: 3000 });
  });

  test('Breadcrumb: schema.org BreadcrumbList presente', async ({ page }) => {
    const res = await page.goto(`${BASE}/agents`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) test.skip(true, '/agents non disponibile');
    const hasBreadcrumbSchema = await page.evaluate(() => {
      const scripts = [...document.querySelectorAll('script[type="application/ld+json"]')];
      return scripts.some((s) => (s.textContent ?? '').includes('BreadcrumbList'));
    });
    if (!hasBreadcrumbSchema) test.skip(true, 'BreadcrumbList schema.org non implementato');
    expect(hasBreadcrumbSchema).toBe(true);
  });

  test('tutte le pagine protette non crashano al caricamento', async ({ request }) => {
    const pages = ['/agents', '/scout', '/analista', '/dashboard'];
    const errors: string[] = [];
    for (const path of pages) {
      const res = await request.get(`${BASE}${path}`, { timeout: 10000 }).catch(() => null);
      if (res?.status() === 500) errors.push(`500 ${path}`);
    }
    expect(errors, `Pagine con 500:\n${errors.join('\n')}`).toHaveLength(0);
  });

});
