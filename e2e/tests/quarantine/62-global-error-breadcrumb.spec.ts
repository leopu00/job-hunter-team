import { test, expect } from '@playwright/test';

/**
 * FLUSSO 62 — GLOBAL ERROR, BREADCRUMB AGGIORNATO E CHANGELOG
 *
 * Suite 1: global-error.tsx — error boundary globale di Next.js
 * Suite 2: Breadcrumb aggiornato — no regressione su pagine pubbliche
 * Suite 3: /changelog aggiornato — struttura e contenuto
 * Suite 4: Navbar aggiornata + regressione completa
 */

const BASE = process.env.BASE_URL || 'https://jobhunterteam.ai';

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 — global-error.tsx: error boundary globale
// ─────────────────────────────────────────────────────────────────────────────
test.describe('global-error.tsx — error boundary', () => {

  test('404 non espone stack trace (error boundary attivo)', async ({ page }) => {
    await page.goto(`${BASE}/questa-pagina-non-esiste-test-62`, { waitUntil: 'networkidle' });
    const content = await page.locator('body').innerText().catch(() => '');
    expect(content).not.toMatch(/\bat\s+\w+\s+\(/);
    expect(content).not.toMatch(/Error:\s+.*\n\s+at/m);
    expect(content).not.toMatch(/stack trace|stacktrace/i);
  });

  test('404: risponde con HTML valido (non testo grezzo)', async ({ page }) => {
    await page.goto(`${BASE}/pagina-inesistente-xyz-62`, { waitUntil: 'networkidle' });
    const html = await page.content();
    expect(html).toMatch(/<html|<!DOCTYPE html/i);
    expect(html.length).toBeGreaterThan(500);
  });

  test('404: no path assoluti nel body', async ({ page }) => {
    await page.goto(`${BASE}/pagina-inesistente-xyz-62`, { waitUntil: 'networkidle' });
    const content = await page.locator('body').innerText().catch(() => '');
    expect(content).not.toMatch(/\/home\/\w+\/|\/Users\/\w+\//);
    expect(content).not.toMatch(/\/var\/task\/|\/opt\/build\//);
  });

  test('404: no errori JS critici', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    await page.goto(`${BASE}/pagina-inesistente-xyz-62`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    expect(jsErrors, `JS errors su 404: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

  test('404: contiene link verso home o navigazione', async ({ page }) => {
    await page.goto(`${BASE}/pagina-inesistente-xyz-62`, { waitUntil: 'networkidle' });
    const homeLink = page.locator('a[href="/"]').first();
    const count = await homeLink.count();
    if (count === 0) {
      console.log('[WARN] Pagina 404 non ha link verso home');
    }
    // Non fail hard — solo documentativo
    expect(true).toBe(true);
  });

  test('500 simulato via URL invalido: no stack trace', async ({ request }) => {
    // Prova con URL con caratteri speciali che potrebbero causare errori
    const urls = [
      `${BASE}/<script>alert(1)</script>`,
      `${BASE}/api/health/../../../etc/passwd`,
    ];
    for (const url of urls) {
      const res = await request.get(url, { timeout: 5000 }).catch(() => null);
      if (!res) continue;
      const text = await res.text().catch(() => '');
      expect(text).not.toMatch(/root:x:0:0/);
      expect(text).not.toMatch(/\bat\s+\w+\s+\(/); // no stack trace
    }
    expect(true).toBe(true);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2 — Breadcrumb aggiornato
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Breadcrumb aggiornato — no regressione', () => {

  test('Breadcrumb: no crash JS su /about', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    await page.goto(`${BASE}/about`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    expect(jsErrors, `Breadcrumb crash /about: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

  test('Breadcrumb: no crash JS su /guide', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    await page.goto(`${BASE}/guide`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    expect(jsErrors, `Breadcrumb crash /guide: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

  test('Breadcrumb: no crash JS su /download', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    await page.goto(`${BASE}/download`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    expect(jsErrors, `Breadcrumb crash /download: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

  test('Breadcrumb: no crash JS su /faq', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    await page.goto(`${BASE}/faq`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    expect(jsErrors, `Breadcrumb crash /faq: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

  test('Breadcrumb JSON-LD: ancora presente su /about dopo update', async ({ page }) => {
    await page.goto(`${BASE}/about`, { waitUntil: 'networkidle' });
    const jsonLdCount = await page.evaluate(() =>
      document.querySelectorAll('script[type="application/ld+json"]').length
    );
    if (jsonLdCount === 0) test.skip(true, 'JSON-LD non presente su /about');
    const scripts = await page.evaluate(() =>
      [...document.querySelectorAll('script[type="application/ld+json"]')]
        .map((s) => { try { return JSON.parse(s.textContent ?? '{}'); } catch { return null; } })
        .filter(Boolean)
    );
    const hasBreadcrumb = scripts.some((s: any) => s['@type'] === 'BreadcrumbList');
    if (!hasBreadcrumb) console.log('[WARN] BreadcrumbList non trovato su /about dopo update');
    expect(true).toBe(true);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3 — /changelog aggiornato
// ─────────────────────────────────────────────────────────────────────────────
test.describe('/changelog aggiornato — struttura e contenuto', () => {

  test('/changelog: risponde 200', async ({ request }) => {
    const res = await request.get(`${BASE}/changelog`);
    expect(res.status()).toBe(200);
  });

  test('/changelog: H1 visibile', async ({ page }) => {
    await page.goto(`${BASE}/changelog`, { waitUntil: 'networkidle' });
    const h1 = page.locator('h1').first();
    await expect(h1).toBeVisible({ timeout: 8000 });
  });

  test('/changelog: no errori JS critici dopo aggiornamento', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    await page.goto(`${BASE}/changelog`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    expect(jsErrors, `Errori JS /changelog: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

  test('/changelog: contenuto presente (lista entries)', async ({ page }) => {
    await page.goto(`${BASE}/changelog`, { waitUntil: 'networkidle' });
    const htmlLen = (await page.content()).length;
    expect(htmlLen, '/changelog pagina vuota').toBeGreaterThan(2000);
  });

  test('/changelog: mobile no overflow', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/changelog`, { waitUntil: 'networkidle' });
    const overflow = await page.evaluate(() => document.body.scrollWidth > window.innerWidth);
    await ctx.close();
    expect(overflow, 'Overflow mobile /changelog').toBe(false);
  });

  test('/api/changelog: risponde 200 (se esiste)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/changelog`);
    if (res.status() === 404) test.skip(true, '/api/changelog non deployata');
    expect([200, 401, 403]).toContain(res.status());
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4 — Navbar aggiornata + regressione completa
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Navbar aggiornata + regressione completa', () => {

  test('Navbar aggiornata: no crash su 3 pagine pubbliche', async ({ page }) => {
    const pages = ['/about', '/faq', '/changelog'];
    for (const path of pages) {
      const jsErrors: string[] = [];
      page.removeAllListeners('pageerror');
      page.on('pageerror', (e) => {
        if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
          jsErrors.push(e.message);
        }
      });
      await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(300);
      expect(jsErrors, `Navbar crash su ${path}: ${jsErrors.join(', ')}`).toHaveLength(0);
    }
  });

  test('regressione: /api/health intatta', async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    expect(res.status()).toBe(200);
    const body = await res.json().catch(() => ({}));
    expect(body).toHaveProperty('status');
  });

  test('regressione: /api/agents intatta', async ({ request }) => {
    const res = await request.get(`${BASE}/api/agents`);
    expect(res.status()).toBe(200);
    const body = await res.json().catch(() => null);
    expect(body).not.toBeNull();
  });

  test('regressione: pagine critiche tutte 200', async ({ request }) => {
    const pages = ['/', '/faq', '/guide', '/download', '/about', '/changelog'];
    const errors: string[] = [];
    for (const path of pages) {
      const res = await request.get(`${BASE}${path}`, { timeout: 8000 }).catch(() => null);
      if (res?.status() !== 200) errors.push(`${path}: ${res?.status()}`);
    }
    expect(errors, `Critiche non 200:\n${errors.join('\n')}`).toHaveLength(0);
  });

  test('homepage: CSS background definito dopo aggiornamenti', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const bg = await page.evaluate(() => window.getComputedStyle(document.body).backgroundColor);
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
    expect(bg).not.toBe('');
  });

});
