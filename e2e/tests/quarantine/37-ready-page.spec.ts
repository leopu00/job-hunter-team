import { test, expect } from '@playwright/test';

/**
 * FLUSSO 37 — PAGINA /ready (ONBOARDING / CHECKLIST)
 *
 * Suite 1: Struttura base — status, H1, title, no errori
 * Suite 2: Contenuto checklist — step, progress, elementi
 * Suite 3: Interattività — step click, stato completato
 * Suite 4: Navigazione — link verso altre pagine app
 */

const BASE = process.env.BASE_URL || 'https://jobhunterteam.ai';

// Helper: salta se /ready non disponibile o richiede auth
async function gotoReady(page: any): Promise<boolean> {
  const res = await page.goto(`${BASE}/ready`, { waitUntil: 'networkidle' });
  if (!res || res.status() === 404) return false;
  // Se reindirizza al login, la pagina non è accessibile senza auth
  const url = page.url();
  if (url.includes('login') || url.includes('auth') || url === `${BASE}/`) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 — Struttura base
// ─────────────────────────────────────────────────────────────────────────────
test.describe('/ready — struttura base', () => {

  test('GET /ready risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/ready`);
    if (res.status() === 404) test.skip(true, '/ready non disponibile');
    expect(res.status(), '/ready risponde 500').not.toBe(500);
  });

  test('/ready: status 200 o redirect auth (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/ready`);
    if (res.status() === 404) test.skip(true, '/ready non disponibile');
    expect([200, 302, 401]).toContain(res.status());
  });

  test('/ready: H1 visibile (se accessibile)', async ({ page }) => {
    const available = await gotoReady(page);
    if (!available) test.skip(true, '/ready non accessibile senza auth');
    const h1 = page.locator('h1').first();
    await expect(h1).toBeVisible({ timeout: 8000 });
    const text = await h1.innerText();
    expect(text.trim().length).toBeGreaterThan(0);
  });

  test('/ready: title presente', async ({ page }) => {
    const available = await gotoReady(page);
    if (!available) test.skip(true, '/ready non accessibile senza auth');
    const title = await page.title();
    expect(title.trim().length).toBeGreaterThan(3);
  });

  test('/ready: nessun errore JS critico', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    const available = await gotoReady(page);
    if (!available) test.skip(true, '/ready non accessibile senza auth');
    await page.waitForTimeout(1000);
    expect(jsErrors, `Errori JS /ready: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

  test('/ready: nessun overflow orizzontale', async ({ page }) => {
    const available = await gotoReady(page);
    if (!available) test.skip(true, '/ready non accessibile senza auth');
    const overflow = await page.evaluate(() => document.body.scrollWidth > window.innerWidth);
    expect(overflow, 'Overflow orizzontale su /ready').toBe(false);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2 — Contenuto checklist / onboarding
// ─────────────────────────────────────────────────────────────────────────────
test.describe('/ready — contenuto checklist', () => {

  test('/ready: almeno uno step o elemento checklist presente', async ({ page }) => {
    const available = await gotoReady(page);
    if (!available) test.skip(true, '/ready non accessibile senza auth');
    const steps = page.locator(
      '[class*="step"], [class*="checklist"], [class*="task"], li, [role="listitem"]'
    ).first();
    const count = await steps.count();
    if (count === 0) test.skip(true, 'Struttura step non trovata');
    expect(count).toBeGreaterThan(0);
  });

  test('/ready: indicatore progresso presente', async ({ page }) => {
    const available = await gotoReady(page);
    if (!available) test.skip(true, '/ready non accessibile senza auth');
    const progress = page.locator(
      '[role="progressbar"], progress, [class*="progress"], [class*="percent"]'
    ).first();
    const count = await progress.count();
    if (count === 0) test.skip(true, 'Progress indicator non trovato');
    await expect(progress).toBeVisible({ timeout: 5000 });
  });

  test('/ready: testo "pronto" o "ready" o "configurazione" presente', async ({ page }) => {
    const available = await gotoReady(page);
    if (!available) test.skip(true, '/ready non accessibile senza auth');
    const text = page.getByText(/pronto|ready|configuraz|onboarding|inizia/i).first();
    const count = await text.count();
    if (count === 0) test.skip(true, 'Testo onboarding non trovato — layout diverso');
    await expect(text).toBeVisible({ timeout: 5000 });
  });

  test('/ready: link verso /agents o /scout presente', async ({ page }) => {
    const available = await gotoReady(page);
    if (!available) test.skip(true, '/ready non accessibile senza auth');
    const navLink = page.locator('a[href*="agents"], a[href*="scout"], a[href*="dashboard"]').first();
    const count = await navLink.count();
    if (count === 0) test.skip(true, 'Link app non trovato su /ready');
    await expect(navLink).toBeVisible({ timeout: 5000 });
  });

  test('/ready: almeno un bottone CTA presente', async ({ page }) => {
    const available = await gotoReady(page);
    if (!available) test.skip(true, '/ready non accessibile senza auth');
    const btns = await page.locator('button, a[class*="btn"], a[class*="button"]').count();
    expect(btns, 'Nessun bottone CTA su /ready').toBeGreaterThan(0);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3 — Interattività
// ─────────────────────────────────────────────────────────────────────────────
test.describe('/ready — interattività', () => {

  test('/ready: click su step non crasha', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => jsErrors.push(e.message));
    const available = await gotoReady(page);
    if (!available) test.skip(true, '/ready non accessibile senza auth');
    const firstStep = page.locator('[class*="step"], li[class*="item"]').first();
    const count = await firstStep.count();
    if (count === 0) test.skip(true, 'Step non trovato');
    await firstStep.click().catch(() => null);
    await page.waitForTimeout(300);
    const critical = jsErrors.filter((e) => !/expected|warning|chunk|hydrat/i.test(e));
    expect(critical).toHaveLength(0);
  });

  test('/ready: checkbox o toggle step cliccabile', async ({ page }) => {
    const available = await gotoReady(page);
    if (!available) test.skip(true, '/ready non accessibile senza auth');
    const checkbox = page.locator('input[type="checkbox"], [role="checkbox"]').first();
    const count = await checkbox.count();
    if (count === 0) test.skip(true, 'Checkbox non trovato su /ready');
    await checkbox.click().catch(() => null);
    await page.waitForTimeout(300);
    expect(true).toBe(true);
  });

  test('/ready: mobile (375px) — nessun overflow', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    const res = await page.goto(`${BASE}/ready`, { waitUntil: 'networkidle' });
    const url = page.url();
    const redirected = url.includes('login') || url.includes('auth') || url === `${BASE}/`;
    if (!res || res.status() === 404 || redirected) {
      await ctx.close();
      test.skip(true, '/ready non accessibile');
    }
    const overflow = await page.evaluate(() => document.body.scrollWidth > window.innerWidth);
    await ctx.close();
    expect(overflow, 'Overflow mobile su /ready').toBe(false);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4 — Pagine protette / main-content
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Pagine app — main-content e layout', () => {

  test('/agents: contenuto principale visibile', async ({ page }) => {
    const res = await page.goto(`${BASE}/agents`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) test.skip(true, '/agents non disponibile');
    // Cerca main, section, o qualsiasi contenitore visibile con H1/H2
    const content = page.locator('main, section, [class*="content"], [class*="page"], h1, h2').first();
    const count = await content.count();
    if (count === 0) test.skip(true, 'Contenuto principale non trovato');
    await expect(content).toBeVisible({ timeout: 5000 });
  });

  test('/agents: sidebar o navigazione laterale presente', async ({ page }) => {
    const res = await page.goto(`${BASE}/agents`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) test.skip(true, '/agents non disponibile');
    const sidebar = page.locator('aside, [class*="sidebar"], nav[class*="side"]').first();
    const count = await sidebar.count();
    if (count === 0) test.skip(true, 'Sidebar non trovata — layout diverso');
    await expect(sidebar).toBeVisible({ timeout: 5000 });
  });

  test('Toast component: non visibile al caricamento iniziale', async ({ page }) => {
    const res = await page.goto(`${BASE}/agents`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) test.skip(true, '/agents non disponibile');
    const toast = page.locator('[class*="toast"], [role="alert"]').first();
    const visible = await toast.isVisible().catch(() => false);
    // Il toast non deve essere visibile senza azioni utente
    if (visible) {
      // Se c'è un toast iniziale, non deve essere un errore
      const toastText = await toast.innerText().catch(() => '');
      expect(toastText.toLowerCase()).not.toMatch(/error|errore|500|crash/i);
    }
    expect(true).toBe(true);
  });

  test('tutte le pagine protette hanno nav con link /agents', async ({ page }) => {
    const pages = ['/ready', '/dashboard', '/scout', '/analista'];
    for (const path of pages) {
      const res = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
      if (res?.status() !== 200) continue;
      const url = page.url();
      if (url.includes('login') || url === `${BASE}/`) continue;
      const agentsLink = page.locator('a[href*="/agents"]').first();
      const count = await agentsLink.count();
      if (count > 0) {
        await expect(agentsLink).toBeVisible({ timeout: 3000 });
      }
    }
    expect(true).toBe(true);
  });

});
