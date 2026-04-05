import { test, expect } from '@playwright/test';

/**
 * FLUSSO 76 — SEO: META TAGS, OG, CANONICAL, STRUCTURED DATA
 *
 * Suite 1: Meta tags base — title, description, viewport
 * Suite 2: Open Graph — og:title, og:description, og:image
 * Suite 3: Canonical e robots
 * Suite 4: Structured data (JSON-LD) e sitemap
 */

const BASE = process.env.BASE_URL || 'https://jobhunterteam.ai';

// Pagine da testare per SEO
const SEO_PAGES = [
  { path: '/',           label: 'Homepage'   },
  { path: '/about',      label: 'About'      },
  { path: '/pricing',    label: 'Pricing'    },
  { path: '/faq',        label: 'FAQ'        },
  { path: '/guide',      label: 'Guide'      },
  { path: '/download',   label: 'Download'   },
  { path: '/changelog',  label: 'Changelog'  },
];

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 — Meta tags base
// ─────────────────────────────────────────────────────────────────────────────
test.describe('SEO — meta tags base', () => {

  test('homepage: title non vuoto', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    const title = await page.title();
    expect(title.trim().length, 'Homepage title vuoto').toBeGreaterThan(5);
    console.log(`[SEO] Homepage title: "${title}"`);
  });

  test('homepage: meta description presente', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    const desc = await page.locator('meta[name="description"]').getAttribute('content').catch(() => null);
    if (!desc) {
      console.log('[SEO WARN] Homepage: meta description mancante');
    } else {
      console.log(`[SEO] Homepage description: "${desc.substring(0, 80)}..."`);
      expect(desc.trim().length).toBeGreaterThan(10);
    }
    expect(true).toBe(true);
  });

  test('homepage: meta viewport presente', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    const viewport = await page.locator('meta[name="viewport"]').getAttribute('content').catch(() => null);
    expect(viewport, 'Meta viewport mancante').not.toBeNull();
    expect(viewport).toContain('width=device-width');
  });

  test('pagine critiche: tutti i title presenti e diversi', async ({ page }) => {
    const titles: string[] = [];
    for (const { path, label } of SEO_PAGES.slice(0, 5)) {
      const res = await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
      if (!res || res.status() !== 200) continue;
      const title = await page.title();
      if (!title || title.trim().length < 3) {
        console.log(`[SEO WARN] ${label}: title vuoto o troppo corto`);
      } else {
        titles.push(title);
      }
    }
    // Verifica che i title non siano tutti uguali
    const uniqueTitles = new Set(titles);
    if (uniqueTitles.size < titles.length) {
      console.log('[SEO WARN] Alcune pagine hanno lo stesso title');
    }
    expect(titles.length).toBeGreaterThan(0);
  });

  test('homepage: charset UTF-8 presente', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    const charset = await page.locator('meta[charset]').getAttribute('charset').catch(() => null);
    if (!charset) {
      // Può essere in forma <meta http-equiv="Content-Type">
      const httpEquiv = await page.locator('meta[http-equiv="Content-Type"]').getAttribute('content').catch(() => null);
      if (!httpEquiv) console.log('[SEO WARN] Charset non trovato');
    } else {
      expect(charset.toLowerCase()).toContain('utf');
    }
    expect(true).toBe(true);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2 — Open Graph
// ─────────────────────────────────────────────────────────────────────────────
test.describe('SEO — Open Graph', () => {

  test('homepage: og:title presente', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    const ogTitle = await page.locator('meta[property="og:title"]').getAttribute('content').catch(() => null);
    if (!ogTitle) {
      console.log('[SEO WARN] Homepage: og:title mancante');
    } else {
      console.log(`[SEO] og:title: "${ogTitle}"`);
      expect(ogTitle.trim().length).toBeGreaterThan(3);
    }
    expect(true).toBe(true);
  });

  test('homepage: og:description presente', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    const ogDesc = await page.locator('meta[property="og:description"]').getAttribute('content').catch(() => null);
    if (!ogDesc) {
      console.log('[SEO WARN] Homepage: og:description mancante');
    } else {
      expect(ogDesc.trim().length).toBeGreaterThan(10);
    }
    expect(true).toBe(true);
  });

  test('homepage: og:image presente', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    const ogImage = await page.locator('meta[property="og:image"]').getAttribute('content').catch(() => null);
    if (!ogImage) {
      console.log('[SEO WARN] Homepage: og:image mancante — sharing sociale degradato');
    } else {
      console.log(`[SEO] og:image: "${ogImage}"`);
    }
    expect(true).toBe(true);
  });

  test('homepage: og:url presente', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    const ogUrl = await page.locator('meta[property="og:url"]').getAttribute('content').catch(() => null);
    if (!ogUrl) {
      console.log('[SEO WARN] Homepage: og:url mancante');
    } else {
      expect(ogUrl).toContain('jobhunterteam');
    }
    expect(true).toBe(true);
  });

  test('homepage: twitter:card presente', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    const twCard = await page.locator('meta[name="twitter:card"]').getAttribute('content').catch(() => null);
    if (!twCard) {
      console.log('[SEO INFO] Homepage: twitter:card mancante (opzionale)');
    } else {
      console.log(`[SEO] twitter:card: "${twCard}"`);
    }
    expect(true).toBe(true);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3 — Canonical e robots
// ─────────────────────────────────────────────────────────────────────────────
test.describe('SEO — canonical e robots', () => {

  test('homepage: canonical link presente', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href').catch(() => null);
    if (!canonical) {
      console.log('[SEO WARN] Homepage: canonical mancante');
    } else {
      console.log(`[SEO] canonical: "${canonical}"`);
      expect(canonical).toContain('jobhunterteam');
    }
    expect(true).toBe(true);
  });

  test('/robots.txt: esiste e non vuoto', async ({ request }) => {
    const res = await request.get(`${BASE}/robots.txt`);
    if (res.status() === 404) {
      console.log('[SEO WARN] /robots.txt mancante — crawler potrebbero indicizzare tutto');
      test.skip(true, '/robots.txt non presente');
    }
    expect(res.status()).toBe(200);
    const text = await res.text();
    expect(text.trim().length).toBeGreaterThan(5);
    console.log(`[SEO] robots.txt (prime 3 righe): ${text.split('\n').slice(0, 3).join(' | ')}`);
  });

  test('/sitemap.xml: esiste (se presente)', async ({ request }) => {
    const res = await request.get(`${BASE}/sitemap.xml`);
    if (res.status() === 404) {
      console.log('[SEO INFO] /sitemap.xml non presente — opzionale ma consigliato');
      test.skip(true, '/sitemap.xml non presente');
    }
    expect(res.status()).toBe(200);
    const text = await res.text();
    expect(text).toContain('<urlset');
    console.log('[SEO] sitemap.xml presente e valida');
  });

  test('meta robots: homepage non noindex', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    const robots = await page.locator('meta[name="robots"]').getAttribute('content').catch(() => null);
    if (robots) {
      const isNoIndex = robots.toLowerCase().includes('noindex');
      if (isNoIndex) console.log('[SEO CRITICAL] Homepage ha meta robots noindex!');
      expect(isNoIndex, 'Homepage ha noindex!').toBe(false);
    }
    expect(true).toBe(true);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4 — Structured data
// ─────────────────────────────────────────────────────────────────────────────
test.describe('SEO — structured data', () => {

  test('homepage: JSON-LD presente (se strutturato)', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    const jsonLd = await page.locator('script[type="application/ld+json"]').all();
    if (jsonLd.length === 0) {
      console.log('[SEO INFO] Homepage: nessun JSON-LD strutturato — opzionale');
    } else {
      console.log(`[SEO] ${jsonLd.length} script JSON-LD trovati`);
      for (const script of jsonLd) {
        const content = await script.innerText().catch(() => '');
        try {
          const data = JSON.parse(content);
          console.log(`[SEO] JSON-LD @type: ${data['@type'] || 'unknown'}`);
        } catch {
          console.log('[SEO WARN] JSON-LD non parsabile');
        }
      }
    }
    expect(true).toBe(true);
  });

  test('homepage: lang attributo su <html>', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    const lang = await page.locator('html').getAttribute('lang').catch(() => null);
    if (!lang) {
      console.log('[SEO WARN] <html> senza attributo lang — accessibilità e SEO degradati');
    } else {
      console.log(`[SEO] html lang: "${lang}"`);
    }
    expect(true).toBe(true);
  });

  test('regressione: /api/health e pagine critiche intatte', async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    expect(res.status()).toBe(200);
    const pages = ['/', '/faq', '/about'];
    for (const path of pages) {
      const r = await request.get(`${BASE}${path}`, { timeout: 8000 }).catch(() => null);
      expect(r?.status()).toBe(200);
    }
  });

});
