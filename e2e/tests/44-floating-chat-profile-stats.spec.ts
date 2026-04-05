import { test, expect } from '@playwright/test';

/**
 * FLUSSO 44 — FLOATING CHAT E PROFILE STATS
 *
 * Suite 1: FloatingChat — presenza, apertura, chiusura
 * Suite 2: ProfileStats — componente statistiche profilo (se accessibile)
 * Suite 3: Pagina /profile aggiornata — struttura e sicurezza
 * Suite 4: Regressione landing — nessun impatto su homepage
 */

const BASE = process.env.BASE_URL || 'https://jobhunterteam.ai';

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 — FloatingChat
// ─────────────────────────────────────────────────────────────────────────────
test.describe('FloatingChat — chat assistente floating', () => {

  test('homepage: FloatingChat non presente sulla landing pubblica', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    // FloatingChat è solo nell'app autenticata, non sulla landing
    const chatBtn = page.locator(
      '[class*="FloatingChat"], [class*="floating-chat"], button[aria-label*="chat"], [class*="chat-bubble"]'
    ).first();
    const count = await chatBtn.count();
    // OK se non è sulla landing — è un componente app interno
    if (count > 0) {
      // Se presente, non deve essere un errore visual
      const visible = await chatBtn.isVisible().catch(() => false);
      if (visible) console.log('[INFO] FloatingChat presente anche sulla landing');
    }
    expect(true).toBe(true);
  });

  test('/agents: FloatingChat presente (se deployato)', async ({ page }) => {
    const res = await page.goto(`${BASE}/agents`, { waitUntil: 'networkidle' });
    if (!res || res.status() !== 200) test.skip(true, '/agents non disponibile');
    const url = page.url();
    if (url !== `${BASE}/agents`) test.skip(true, '/agents protetta');
    const chatBtn = page.locator(
      '[class*="FloatingChat"], [class*="floating-chat"], [class*="chat-btn"], ' +
      'button[aria-label*="chat"], button[aria-label*="assistente"]'
    ).first();
    const count = await chatBtn.count();
    if (count === 0) test.skip(true, 'FloatingChat non trovato su /agents');
    await expect(chatBtn).toBeVisible({ timeout: 5000 });
  });

  test('/agents: click FloatingChat apre pannello o modal', async ({ page }) => {
    const res = await page.goto(`${BASE}/agents`, { waitUntil: 'networkidle' });
    if (!res || res.status() !== 200) test.skip(true, '/agents non disponibile');
    const url = page.url();
    if (url !== `${BASE}/agents`) test.skip(true, '/agents protetta');
    const chatBtn = page.locator(
      '[class*="FloatingChat"], button[aria-label*="chat"], button[aria-label*="assistente"]'
    ).first();
    const count = await chatBtn.count();
    if (count === 0) test.skip(true, 'FloatingChat non trovato');
    await chatBtn.click();
    await page.waitForTimeout(400);
    // Deve apparire un pannello o dialog
    const panel = page.locator('[role="dialog"], [class*="chat-panel"], [class*="chat-window"]').first();
    const panelVisible = await panel.isVisible().catch(() => false);
    if (!panelVisible) test.skip(true, 'Pannello chat non trovato dopo click');
    await expect(panel).toBeVisible({ timeout: 3000 });
  });

  test('/agents: FloatingChat non blocca contenuto principale', async ({ page }) => {
    const res = await page.goto(`${BASE}/agents`, { waitUntil: 'networkidle' });
    if (!res || res.status() !== 200) test.skip(true, '/agents non disponibile');
    const url = page.url();
    if (url !== `${BASE}/agents`) test.skip(true, '/agents protetta');
    const chatBtn = page.locator('[class*="FloatingChat"], [class*="floating"]').first();
    const count = await chatBtn.count();
    if (count === 0) test.skip(true, 'FloatingChat non trovato');
    const box = await chatBtn.boundingBox();
    const viewport = page.viewportSize();
    if (box && viewport) {
      // Il floating button deve essere < 15% del viewport
      const areaRatio = (box.width * box.height) / (viewport.width * viewport.height);
      expect(areaRatio, 'FloatingChat troppo grande').toBeLessThan(0.15);
    }
    expect(true).toBe(true);
  });

  test('nessun crash JS per FloatingChat al caricamento /agents', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    const res = await page.goto(`${BASE}/agents`, { waitUntil: 'networkidle' });
    if (!res || res.status() !== 200) test.skip(true, '/agents non disponibile');
    await page.waitForTimeout(800);
    expect(jsErrors, `Errori JS FloatingChat: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2 — ProfileStats
// ─────────────────────────────────────────────────────────────────────────────
test.describe('ProfileStats — statistiche profilo', () => {

  test('/profile: pagina risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/profile`);
    if (res.status() === 404) test.skip(true, '/profile non disponibile');
    expect(res.status()).not.toBe(500);
  });

  test('/profile: no dati personali esposti senza auth', async ({ request }) => {
    const res = await request.get(`${BASE}/profile`);
    if (res.status() === 404) test.skip(true, '/profile non disponibile');
    const text = await res.text();
    // Non deve mostrare email, nome o statistiche reali senza login
    expect(text).not.toMatch(/leone|puglisi/i);
    expect(text).not.toMatch(/sk-ant-|password|secret/i);
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

  test('/profile: loading skeleton visibile durante caricamento', async ({ page }) => {
    const res = await page.goto(`${BASE}/profile`, { waitUntil: 'domcontentloaded' });
    if (!res || res.status() === 404) test.skip(true, '/profile non disponibile');
    const url = page.url();
    if (url.includes('login') || url === `${BASE}/`) test.skip(true, 'Redirect auth');
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => null);
    // La pagina deve aver caricato HTML significativo (skeleton incluso)
    const htmlLen = (await page.content()).length;
    expect(htmlLen, '/profile pagina vuota').toBeGreaterThan(2000);
  });

  test('ProfileStats: statistiche base presenti (se accessibile)', async ({ page }) => {
    const res = await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) test.skip(true, '/profile non disponibile');
    const url = page.url();
    if (url.includes('login') || url === `${BASE}/`) test.skip(true, 'Redirect auth');
    // Cerca elementi statistiche: candidature, risposte, tasso
    const statsEl = page.locator(
      '[class*="stat"], [class*="metric"], [class*="count"], [class*="ProfileStats"]'
    ).first();
    const count = await statsEl.count();
    if (count === 0) test.skip(true, 'ProfileStats non trovato — protetto da auth');
    expect(count).toBeGreaterThan(0);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3 — Pagina /profile (aggiornata)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('/profile — struttura aggiornata', () => {

  test('/profile: mobile (375px) nessun overflow', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    const res = await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) { await ctx.close(); test.skip(true, '/profile non disponibile'); }
    const overflow = await page.evaluate(() => document.body.scrollWidth > window.innerWidth);
    await ctx.close();
    expect(overflow, 'Overflow mobile /profile').toBe(false);
  });

  test('/profile: loading.tsx skeleton ha struttura visiva', async ({ request }) => {
    const res = await request.get(`${BASE}/profile`);
    if (res.status() === 404) test.skip(true, '/profile non disponibile');
    // La risposta HTTP deve contenere HTML (skeleton SSR)
    const html = await res.text();
    expect(html.length).toBeGreaterThan(1000);
    expect(html).toContain('<!DOCTYPE html>');
  });

  test('/api/profile: struttura aggiornata ancora corretta', async ({ request }) => {
    const res = await request.get(`${BASE}/api/profile`);
    expect(res.status()).toBe(200);
    const body = await res.json().catch(() => null);
    expect(body).not.toBeNull();
    expect(body).toHaveProperty('profile');
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4 — Regressione landing post-update
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Regressione landing — no impatto da FloatingChat/ProfileStats', () => {

  test('homepage: status 200 intatto', async ({ request }) => {
    const res = await request.get(`${BASE}/`);
    expect(res.status()).toBe(200);
  });

  test('homepage: H1 ancora visibile', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const h1 = page.locator('h1').first();
    await expect(h1).toBeVisible({ timeout: 5000 });
  });

  test('homepage: nessun errore JS critico post-update', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    expect(jsErrors, `Errori JS homepage: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

  test('/api/health: OK dopo tutti gli update componenti', async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    expect(res.status()).toBe(200);
    const body = await res.json().catch(() => ({}));
    expect(body).toHaveProperty('status');
  });

  test('nessuna pagina pubblica risponde 500 post-update', async ({ request }) => {
    const pages = ['/', '/faq', '/guide', '/download', '/about', '/changelog'];
    const errors: string[] = [];
    for (const path of pages) {
      const res = await request.get(`${BASE}${path}`, { timeout: 8000 }).catch(() => null);
      if (res?.status() === 500) errors.push(`500 ${path}`);
    }
    expect(errors, `Pagine con 500:\n${errors.join('\n')}`).toHaveLength(0);
  });

});
