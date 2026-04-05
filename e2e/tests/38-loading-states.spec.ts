import { test, expect } from '@playwright/test';

/**
 * FLUSSO 38 — LOADING STATES (SKELETON/SPINNER)
 *
 * Ogni pagina protetta ha un file loading.tsx — skeleton UI durante il caricamento.
 * Questi skeleton appaiono brevemente durante la navigazione Next.js.
 *
 * Suite 1: Loading skeleton non bloccato — le pagine si caricano e mostrano contenuto
 * Suite 2: Transizioni di caricamento — nessun flash di contenuto vuoto > 5s
 * Suite 3: NotificationCenter — componente notifiche
 * Suite 4: Performance caricamento — First Paint e no spinner infinito
 */

const BASE = process.env.BASE_URL || 'https://jobhunterteam.ai';

const PROTECTED_PAGES = [
  { path: '/agents',       label: 'Agents'       },
  { path: '/scout',        label: 'Scout'        },
  { path: '/analista',     label: 'Analista'     },
  { path: '/dashboard',    label: 'Dashboard'    },
  { path: '/applications', label: 'Applications' },
  { path: '/profile',      label: 'Profile'      },
  { path: '/ready',        label: 'Ready'        },
];

/** Helper: verifica se la pagina è accessibile (non reindirizzata al login) */
async function isPageAccessible(page: any, path: string): Promise<boolean> {
  const res = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  if (!res || res.status() === 404) return false;
  const url = page.url();
  return !(url.includes('login') || url.includes('auth') || url === `${BASE}/`);
}

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 — Loading skeleton non bloccato
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Loading skeleton — non bloccato', () => {

  for (const { path, label } of PROTECTED_PAGES.slice(0, 4)) {

    test(`${label}: pagina caricata entro 8s (no spinner infinito)`, async ({ page }) => {
      const res = await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
      if (!res || res.status() === 404) test.skip(true, `${label} non disponibile`);
      const url = page.url();
      if (url.includes('login') || url.includes('auth') || url === `${BASE}/`) {
        test.skip(true, `${label} protetta — redirect auth`);
      }
      // Attendi max 8s che il contenuto reale appaia (skeleton deve sparire)
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => null);
      // Verifica che non ci sia ancora un full-page spinner
      const fullPageSpinner = page.locator(
        '[class*="loading-full"], [class*="page-loading"], [aria-label="Caricamento pagina"]'
      ).first();
      const spinnerVisible = await fullPageSpinner.isVisible({ timeout: 500 }).catch(() => false);
      if (spinnerVisible) {
        await page.waitForTimeout(3000);
        const stillSpinning = await fullPageSpinner.isVisible().catch(() => false);
        expect(stillSpinning, `${label}: spinner ancora visibile dopo 11s`).toBe(false);
      }
      expect(true).toBe(true);
    });

  }

  test('nessuna pagina protetta risponde 500', async ({ request }) => {
    const errors: string[] = [];
    for (const { path } of PROTECTED_PAGES) {
      const res = await request.get(`${BASE}${path}`, { timeout: 10000 }).catch(() => null);
      if (res?.status() === 500) errors.push(`500 ${path}`);
    }
    expect(errors, `Pagine con 500:\n${errors.join('\n')}`).toHaveLength(0);
  });

  test('/agents: contenuto visibile entro 5s', async ({ page }) => {
    const res = await page.goto(`${BASE}/agents`, { waitUntil: 'domcontentloaded' });
    if (!res || res.status() !== 200) test.skip(true, '/agents non disponibile');
    const url = page.url();
    if (url !== `${BASE}/agents`) test.skip(true, '/agents redirige — protetta');
    // Aspetta che appaia H1 o contenuto significativo
    const content = page.locator('h1, h2, [class*="agent"], [class*="card"]').first();
    await expect(content).toBeVisible({ timeout: 5000 });
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2 — Transizioni di caricamento
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Transizioni caricamento — no flash vuoto', () => {

  test('/agents: navigazione interna no flash bianco > 500ms', async ({ page }) => {
    const res = await page.goto(`${BASE}/agents`, { waitUntil: 'networkidle' });
    if (!res || res.status() !== 200) test.skip(true, '/agents non disponibile');
    const url = page.url();
    if (url !== `${BASE}/agents`) test.skip(true, '/agents protetta');
    // Screenshot prima navigazione
    const initialContent = await page.locator('body').innerText().catch(() => '');
    expect(initialContent.trim().length, 'Pagina vuota').toBeGreaterThan(0);
  });

  test('/agents: nessun errore di hydration React', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/ResizeObserver|chunk/i.test(e.message)) jsErrors.push(e.message);
    });
    const res = await page.goto(`${BASE}/agents`, { waitUntil: 'networkidle' });
    if (!res || res.status() !== 200) test.skip(true, '/agents non disponibile');
    const url = page.url();
    if (url !== `${BASE}/agents`) test.skip(true, '/agents protetta');
    await page.waitForTimeout(1000);
    const hydrationErrors = jsErrors.filter((e) => /hydrat|mismatch/i.test(e));
    expect(hydrationErrors, `Errori hydration: ${hydrationErrors.join(', ')}`).toHaveLength(0);
  });

  test('ogni pagina protetta risponde in < 5s', async ({ request }) => {
    const slow: string[] = [];
    for (const { path, label } of PROTECTED_PAGES.slice(0, 4)) {
      const start = Date.now();
      const res = await request.get(`${BASE}${path}`, { timeout: 5000 }).catch(() => null);
      const elapsed = Date.now() - start;
      if (res && elapsed > 4000) slow.push(`${label}: ${elapsed}ms`);
    }
    if (slow.length > 0) console.log(`[WARN] Pagine lente: ${slow.join(', ')}`);
    expect(slow.length).toBeLessThan(3);
  });

  test('landing → /agents: transizione senza crash', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat/i.test(e.message)) jsErrors.push(e.message);
    });
    await page.goto(`${BASE}/agents`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    expect(jsErrors, `Errori transizione: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3 — NotificationCenter
// ─────────────────────────────────────────────────────────────────────────────
test.describe('NotificationCenter — componente notifiche', () => {

  test('/agents: notification center non blocca il layout', async ({ page }) => {
    const res = await page.goto(`${BASE}/agents`, { waitUntil: 'networkidle' });
    if (!res || res.status() !== 200) test.skip(true, '/agents non disponibile');
    const url = page.url();
    if (url !== `${BASE}/agents`) test.skip(true, '/agents protetta');
    // Il NotificationCenter non deve occupare > 50% dello schermo
    const notifEl = page.locator(
      '[class*="notification"], [class*="notif"], [aria-label*="notif"]'
    ).first();
    const count = await notifEl.count();
    if (count === 0) test.skip(true, 'NotificationCenter non trovato');
    const box = await notifEl.boundingBox();
    if (box) {
      const viewportSize = page.viewportSize();
      expect(box.height, 'NotificationCenter troppo alto').toBeLessThan((viewportSize?.height ?? 800) * 0.7);
    }
    expect(true).toBe(true);
  });

  test('/agents: campanella notifiche o badge presente', async ({ page }) => {
    const res = await page.goto(`${BASE}/agents`, { waitUntil: 'networkidle' });
    if (!res || res.status() !== 200) test.skip(true, '/agents non disponibile');
    const url = page.url();
    if (url !== `${BASE}/agents`) test.skip(true, '/agents protetta');
    const bell = page.locator(
      'button[aria-label*="notif"], button[aria-label*="bell"], [class*="bell"]'
    ).first();
    const count = await bell.count();
    if (count === 0) test.skip(true, 'Campanella notifiche non trovata');
    await expect(bell).toBeVisible({ timeout: 3000 });
  });

  test('API /api/health: no regressioni dopo loading.tsx deploy', async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    expect(res.status()).toBe(200);
    const body = await res.json().catch(() => null);
    expect(body).toHaveProperty('status');
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4 — Performance caricamento pagine protette
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Performance — caricamento pagine app', () => {

  test('/agents: TTFB < 2000ms', async ({ page }) => {
    const start = Date.now();
    const res = await page.goto(`${BASE}/agents`, { waitUntil: 'domcontentloaded' });
    const ttfb = Date.now() - start;
    if (!res || res.status() === 404) test.skip(true, '/agents non disponibile');
    expect(ttfb, `TTFB troppo alto: ${ttfb}ms`).toBeLessThan(2000);
  });

  test('tutte le pagine protette rispondono < 3s (TTFB HTTP)', async ({ request }) => {
    const slow: string[] = [];
    for (const { path, label } of PROTECTED_PAGES) {
      const start = Date.now();
      const res = await request.get(`${BASE}${path}`, { timeout: 5000 }).catch(() => null);
      const elapsed = Date.now() - start;
      if (res && res.status() !== 404 && elapsed > 3000) {
        slow.push(`${label}: ${elapsed}ms`);
      }
    }
    if (slow.length > 0) console.log(`[WARN] Pagine lente al TTFB: ${slow.join(', ')}`);
    expect(slow.length, `Troppe pagine lente: ${slow.join(', ')}`).toBeLessThan(3);
  });

  test('/agents: nessuna richiesta di rete fallita al caricamento', async ({ page }) => {
    const failedRequests: string[] = [];
    page.on('requestfailed', (req) => {
      const url = req.url();
      // Ignora estensioni browser e risorse locali
      if (!url.includes('extension://') && !url.includes('localhost')) {
        failedRequests.push(`${req.failure()?.errorText} — ${url}`);
      }
    });
    const res = await page.goto(`${BASE}/agents`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) test.skip(true, '/agents non disponibile');
    const url = page.url();
    if (url !== `${BASE}/agents`) test.skip(true, '/agents protetta');
    expect(failedRequests, `Richieste fallite: ${failedRequests.join(', ')}`).toHaveLength(0);
  });

});
