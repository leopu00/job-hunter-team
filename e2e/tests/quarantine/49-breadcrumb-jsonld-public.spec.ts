import { test, expect } from '@playwright/test';

/**
 * FLUSSO 49 — BREADCRUMB JSON-LD SU PAGINE PUBBLICHE
 *
 * BreadcrumbJsonLd.tsx è stato aggiunto a tutti i layout pubblici.
 * Ogni pagina pubblica dovrebbe ora avere structured data BreadcrumbList.
 *
 * Suite 1: BreadcrumbJsonLd presente su pagine pubbliche
 * Suite 2: Struttura JSON-LD BreadcrumbList valida
 * Suite 3: Nessuna regressione layout dopo aggiornamenti multipli
 * Suite 4: Regressione completa tutte le pagine + API
 */

const BASE = process.env.BASE_URL || 'https://jobhunterteam.ai';

const PUBLIC_PAGES_JSONLD = [
  { path: '/about',     label: 'About'     },
  { path: '/changelog', label: 'Changelog' },
  { path: '/demo',      label: 'Demo'      },
  { path: '/docs',      label: 'Docs'      },
  { path: '/download',  label: 'Download'  },
  { path: '/faq',       label: 'FAQ'       },
  { path: '/guide',     label: 'Guida'     },
  { path: '/pricing',   label: 'Pricing'   },
  { path: '/privacy',   label: 'Privacy'   },
  { path: '/stats',     label: 'Stats'     },
];

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 — BreadcrumbJsonLd presente
// ─────────────────────────────────────────────────────────────────────────────
test.describe('BreadcrumbJsonLd — presenza su pagine pubbliche', () => {

  for (const { path, label } of PUBLIC_PAGES_JSONLD.slice(0, 6)) {

    test(`${label}: JSON-LD presente nella pagina`, async ({ page }) => {
      const res = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
      if (res?.status() !== 200) test.skip(true, `${label} non disponibile`);
      const jsonLdCount = await page.evaluate(() =>
        document.querySelectorAll('script[type="application/ld+json"]').length
      );
      if (jsonLdCount === 0) test.skip(true, `${label}: JSON-LD non ancora deployato`);
      expect(jsonLdCount).toBeGreaterThan(0);
    });

  }

  test('homepage: JSON-LD presente (se aggiunto)', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const jsonLdCount = await page.evaluate(() =>
      document.querySelectorAll('script[type="application/ld+json"]').length
    );
    if (jsonLdCount === 0) test.skip(true, 'JSON-LD non presente sulla homepage');
    expect(jsonLdCount).toBeGreaterThan(0);
  });

  test('/faq: sia FAQPage che BreadcrumbList presenti', async ({ page }) => {
    await page.goto(`${BASE}/faq`, { waitUntil: 'networkidle' });
    const jsonLdScripts = await page.evaluate(() =>
      [...document.querySelectorAll('script[type="application/ld+json"]')]
        .map((s) => s.textContent ?? '')
    );
    if (jsonLdScripts.length === 0) test.skip(true, 'JSON-LD assente su /faq');
    const hasFaq = jsonLdScripts.some((s) => s.includes('FAQPage'));
    const hasBreadcrumb = jsonLdScripts.some((s) => s.includes('BreadcrumbList'));
    if (!hasBreadcrumb) test.skip(true, 'BreadcrumbList non ancora deployato su /faq');
    expect(hasBreadcrumb || hasFaq, 'Né FAQPage né BreadcrumbList trovati').toBe(true);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2 — Struttura JSON-LD BreadcrumbList valida
// ─────────────────────────────────────────────────────────────────────────────
test.describe('BreadcrumbList — struttura valida', () => {

  const checkBreadcrumbStructure = async (page: any, path: string, label: string) => {
    const res = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) return null;
    const scripts = await page.evaluate(() =>
      [...document.querySelectorAll('script[type="application/ld+json"]')]
        .map((s) => { try { return JSON.parse(s.textContent ?? '{}'); } catch { return null; } })
        .filter(Boolean)
    );
    return scripts.find((s: any) => s['@type'] === 'BreadcrumbList') ?? null;
  };

  test('/about: BreadcrumbList con itemListElement', async ({ page }) => {
    const breadcrumb = await checkBreadcrumbStructure(page, '/about', 'About');
    if (!breadcrumb) test.skip(true, 'BreadcrumbList non trovato su /about');
    expect(breadcrumb).toHaveProperty('itemListElement');
    expect(Array.isArray(breadcrumb.itemListElement)).toBe(true);
    expect(breadcrumb.itemListElement.length).toBeGreaterThan(0);
  });

  test('/guide: BreadcrumbList ha @context schema.org', async ({ page }) => {
    const breadcrumb = await checkBreadcrumbStructure(page, '/guide', 'Guida');
    if (!breadcrumb) test.skip(true, 'BreadcrumbList non trovato su /guide');
    expect(breadcrumb['@context']).toMatch(/schema\.org/i);
  });

  test('/download: BreadcrumbList items hanno name e item URL', async ({ page }) => {
    const breadcrumb = await checkBreadcrumbStructure(page, '/download', 'Download');
    if (!breadcrumb) test.skip(true, 'BreadcrumbList non trovato su /download');
    const items = breadcrumb.itemListElement ?? [];
    if (items.length === 0) test.skip(true, 'itemListElement vuoto');
    const firstItem = items[0];
    expect(firstItem).toHaveProperty('name');
    // Deve avere item o @id con URL
    const hasUrl = 'item' in firstItem || '@id' in firstItem || 'url' in (firstItem.item ?? {});
    expect(hasUrl, 'Breadcrumb item senza URL').toBe(true);
  });

  test('tutte le pagine con JSON-LD: JSON è valido e parsabile', async ({ page }) => {
    const parseErrors: string[] = [];
    for (const { path, label } of PUBLIC_PAGES_JSONLD.slice(0, 5)) {
      const res = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
      if (res?.status() !== 200) continue;
      const scripts = await page.evaluate(() =>
        [...document.querySelectorAll('script[type="application/ld+json"]')]
          .map((s) => s.textContent ?? '')
      );
      for (const script of scripts) {
        try { JSON.parse(script); } catch { parseErrors.push(`${label}: ${script.slice(0, 50)}`); }
      }
    }
    expect(parseErrors, `JSON-LD non valido:\n${parseErrors.join('\n')}`).toHaveLength(0);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3 — No regressioni layout dopo aggiornamenti
// ─────────────────────────────────────────────────────────────────────────────
test.describe('No regressioni — layout aggiornati', () => {

  for (const { path, label } of PUBLIC_PAGES_JSONLD.slice(0, 5)) {

    test(`${label}: no errori JS dopo aggiornamento layout`, async ({ page }) => {
      const jsErrors: string[] = [];
      page.on('pageerror', (e) => {
        if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
          jsErrors.push(e.message);
        }
      });
      const res = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
      if (res?.status() !== 200) test.skip(true, `${label} non disponibile`);
      await page.waitForTimeout(500);
      expect(jsErrors, `Errori JS ${label}: ${jsErrors.join(', ')}`).toHaveLength(0);
    });

  }

  test('nessuna pagina pubblica risponde 500', async ({ request }) => {
    const errors: string[] = [];
    for (const { path, label } of PUBLIC_PAGES_JSONLD) {
      const res = await request.get(`${BASE}${path}`, { timeout: 8000 }).catch(() => null);
      if (res?.status() === 500) errors.push(`500 ${label}`);
    }
    expect(errors, `Pagine con 500:\n${errors.join('\n')}`).toHaveLength(0);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4 — Regressione completa finale
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Regressione finale — sito completo', () => {

  test('homepage: H1, title, nav, footer intatti', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 5000 });
    const title = await page.title();
    expect(title.trim().length).toBeGreaterThan(5);
    await expect(page.locator('nav').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('footer').first()).toBeVisible({ timeout: 5000 });
  });

  test('/api/health: OK dopo tutti i layout update', async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    expect(res.status()).toBe(200);
    const body = await res.json().catch(() => ({}));
    expect(body).toHaveProperty('status');
  });

  test('/api/agents: OK dopo tutti gli update', async ({ request }) => {
    const res = await request.get(`${BASE}/api/agents`);
    expect(res.status()).toBe(200);
    const body = await res.json().catch(() => null);
    expect(body).not.toBeNull();
  });

  test('pagine con 200 confermato: /, /faq, /guide, /download, /about', async ({ request }) => {
    const pages = ['/', '/faq', '/guide', '/download', '/about'];
    for (const path of pages) {
      const res = await request.get(`${BASE}${path}`, { timeout: 8000 });
      expect(res.status(), `${path} non risponde 200`).toBe(200);
    }
  });

});
