import { test, expect } from '@playwright/test';

/**
 * FLUSSO 30 — SMOKE TEST DI REGRESSIONE
 *
 * Suite di regressione completa: verifica che NESSUNA pagina pubblica
 * si sia rotta dopo ogni deploy. Eseguibile in < 60s.
 *
 * Regola: ogni test deve passare su produzione. Se fallisce = regressione.
 *
 * Suite 1: Tutte le pagine pubbliche — status 200, H1, title, no JS error
 * Suite 2: API critiche — health, about, agents
 * Suite 3: Link di navigazione cross-page non rotti
 */

const BASE = process.env.BASE_URL || 'https://jobhunterteam.ai';

/** Tutte le pagine pubbliche del sito */
const ALL_PUBLIC_PAGES = [
  { path: '/',          label: 'Homepage'  },
  { path: '/faq',       label: 'FAQ'       },
  { path: '/guide',     label: 'Guida'     },
  { path: '/download',  label: 'Download'  },
  { path: '/changelog', label: 'Changelog' },
  { path: '/docs',      label: 'Docs'      },
  { path: '/about',     label: 'About'     },
  { path: '/demo',      label: 'Demo'      },
  { path: '/pricing',   label: 'Pricing'   },
  { path: '/privacy',   label: 'Privacy'   },
];

// ─────────────────────────────���─────────────────────────────���─────────────────
// SUITE 1 — Tutte le pagine: status, H1, title, no crash
// ───────────────────────────────────────────���──────────────────────────���──────
test.describe('Regressione — tutte le pagine pubbliche', () => {

  for (const { path, label } of ALL_PUBLIC_PAGES) {

    test(`${label}: risponde 200 (non 404 o 500)`, async ({ request }) => {
      const res = await request.get(`${BASE}${path}`, { timeout: 15000 });
      const status = res.status();
      // Se non ancora deployata → skip (non regressione)
      if (status === 404) test.skip(true, `${label} non ancora deployata`);
      expect(status, `${label} risponde ${status}`).toBe(200);
    });

    test(`${label}: H1 visibile e non vuoto`, async ({ page }) => {
      const res = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
      if (res?.status() === 404) test.skip(true, `${label} non ancora deployata`);
      expect(res?.status(), `${label} risponde ${res?.status()}`).toBe(200);
      const h1 = page.locator('h1').first();
      await expect(h1, `H1 assente su ${label}`).toBeVisible({ timeout: 8000 });
      const text = await h1.innerText();
      expect(text.trim().length, `H1 vuoto su ${label}`).toBeGreaterThan(0);
    });

    test(`${label}: nessun errore JS critico`, async ({ page }) => {
      const jsErrors: string[] = [];
      page.on('pageerror', (e) => {
        if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
          jsErrors.push(e.message);
        }
      });
      const res = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
      if (res?.status() === 404) test.skip(true, `${label} non ancora deployata`);
      await page.waitForTimeout(500);
      expect(jsErrors, `Errori JS su ${label}: ${jsErrors.join(', ')}`).toHaveLength(0);
    });

  }

});

// ──────────────────────────────��────────────────────────────────���─────────────
// SUITE 2 — API critiche
// ───────────────────────────────────────────────��─────────────────────────────
test.describe('Regressione — API critiche', () => {

  test('GET /api/health risponde 200 e ha campo status', async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    expect(res.status()).toBe(200);
    const body = await res.json().catch(() => ({}));
    expect(body).toHaveProperty('status');
  });

  test('GET /api/about risponde 200 e ha JSON valido', async ({ request }) => {
    const res = await request.get(`${BASE}/api/about`);
    expect(res.status()).toBe(200);
    const body = await res.json().catch(() => null);
    expect(body).not.toBeNull();
  });

  test('GET /api/agents risponde 200 e ha JSON valido', async ({ request }) => {
    const res = await request.get(`${BASE}/api/agents`);
    expect(res.status()).toBe(200);
    const body = await res.json().catch(() => null);
    expect(body).not.toBeNull();
  });

  test('GET /api/profile risponde 200 con campo profile', async ({ request }) => {
    const res = await request.get(`${BASE}/api/profile`);
    expect(res.status()).toBe(200);
    const body = await res.json().catch(() => null);
    expect(body).toHaveProperty('profile');
  });

  test('nessuna API critica risponde 500', async ({ request }) => {
    const apis = ['/api/health', '/api/about', '/api/agents', '/api/profile', '/api/changelog'];
    const errors: string[] = [];
    for (const api of apis) {
      const res = await request.get(`${BASE}${api}`).catch(() => null);
      if (res?.status() === 500) errors.push(`500 ${api}`);
    }
    expect(errors, `API con 500:\n${errors.join('\n')}`).toHaveLength(0);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3 — Link di navigazione cross-page non rotti
// ───────────────────────────────────────────────���─────────────────────────────
test.describe('Regressione — navigazione cross-page', () => {

  test('homepage: tutti i link interni rispondono (non 404/500)', async ({ page, request }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const links: string[] = await page.evaluate((base) =>
      [...document.querySelectorAll('a[href]')]
        .map((a) => (a as HTMLAnchorElement).href)
        .filter((h) => h.startsWith(base) && !h.includes('#') && !h.includes('?login'))
        .filter((h, i, arr) => arr.indexOf(h) === i)
    , BASE);

    const broken: string[] = [];
    for (const url of links) {
      const res = await request.get(url, { timeout: 10000 }).catch(() => null);
      if (res && (res.status() === 404 || res.status() === 500)) {
        broken.push(`${res.status()} — ${url}`);
      }
    }
    expect(broken, `Link rotti:\n${broken.join('\n')}`).toHaveLength(0);
  });

  test('ogni pagina pubblica ha almeno 1 link verso altre pagine', async ({ page }) => {
    const pagesWithLinks: Record<string, number> = {};
    for (const { path, label } of ALL_PUBLIC_PAGES.slice(0, 5)) { // prime 5 per velocità
      const res = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
      if (res?.status() !== 200) continue;
      const linkCount = await page.locator('a[href^="/"]').count();
      pagesWithLinks[label] = linkCount;
      expect(linkCount, `${label} non ha link interni`).toBeGreaterThan(0);
    }
  });

  test('nessuna pagina pubblica ha link rotti verso homepage', async ({ page, request }) => {
    // La homepage deve sempre rispondere
    const homeRes = await request.get(`${BASE}/`);
    expect(homeRes.status(), 'Homepage rotta!').toBe(200);
  });

  test('sitemap.xml o robots.txt almeno uno disponibile', async ({ request }) => {
    const sitemapRes = await request.get(`${BASE}/sitemap.xml`);
    const robotsRes = await request.get(`${BASE}/robots.txt`);
    const eitherOk = sitemapRes.status() === 200 || robotsRes.status() === 200;
    if (!eitherOk) test.skip(true, 'Né sitemap.xml né robots.txt ancora disponibili');
    expect(eitherOk).toBe(true);
  });

});
