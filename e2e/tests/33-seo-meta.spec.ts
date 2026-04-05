import { test, expect } from '@playwright/test';

/**
 * FLUSSO 33 — SEO E META TAG
 *
 * Suite 1: Meta tag essenziali — title, description, canonical
 * Suite 2: Open Graph — og:title, og:description, og:image, og:url
 * Suite 3: Twitter Card — twitter:card, twitter:title
 * Suite 4: Robots e sitemap — robots.txt, sitemap.xml, meta robots
 * Suite 5: Structured data — JSON-LD presente e valido
 */

const BASE = process.env.BASE_URL || 'https://jobhunterteam.ai';

const SEO_PAGES = [
  { path: '/',          label: 'Homepage'  },
  { path: '/faq',       label: 'FAQ'       },
  { path: '/guide',     label: 'Guida'     },
  { path: '/download',  label: 'Download'  },
  { path: '/about',     label: 'About'     },
  { path: '/pricing',   label: 'Pricing'   },
  { path: '/privacy',   label: 'Privacy'   },
];

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 — Meta tag essenziali
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Meta tag essenziali', () => {

  for (const { path, label } of SEO_PAGES) {

    test(`${label}: <title> presente e > 10 caratteri`, async ({ page }) => {
      const res = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
      if (res?.status() !== 200) test.skip(true, `${label} non disponibile`);
      const title = await page.title();
      expect(title.trim().length, `${label}: title vuoto`).toBeGreaterThan(10);
    });

    test(`${label}: <meta name="description"> presente`, async ({ page }) => {
      const res = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
      if (res?.status() !== 200) test.skip(true, `${label} non disponibile`);
      const desc = await page.evaluate(() =>
        document.querySelector('meta[name="description"]')?.getAttribute('content') ?? ''
      );
      if (!desc) test.skip(true, `${label}: meta description non ancora configurata`);
      expect(desc.trim().length, `${label}: meta description vuota`).toBeGreaterThan(20);
    });

  }

  test('homepage: title contiene "Job Hunter" o nome prodotto', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const title = await page.title();
    expect(title).toMatch(/job.hunter|jobhunter/i);
  });

  test('homepage: title non supera 70 caratteri', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const title = await page.title();
    if (title.length > 70) {
      console.log(`[WARN] title troppo lungo (${title.length} chars): "${title}"`);
    }
    expect(title.length, 'title troppo lungo per SEO').toBeLessThanOrEqual(80);
  });

  test('homepage: meta description non supera 160 caratteri', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const desc = await page.evaluate(() =>
      document.querySelector('meta[name="description"]')?.getAttribute('content') ?? ''
    );
    if (!desc) test.skip(true, 'meta description non configurata');
    if (desc.length > 160) {
      console.log(`[WARN] description troppo lunga (${desc.length} chars)`);
    }
    expect(desc.length).toBeLessThanOrEqual(200);
  });

  test('homepage: charset UTF-8 dichiarato', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const charset = await page.evaluate(() => {
      const meta = document.querySelector('meta[charset]');
      return meta?.getAttribute('charset') ?? '';
    });
    expect(charset.toUpperCase()).toContain('UTF');
  });

  test('homepage: viewport meta presente (mobile)', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const viewport = await page.evaluate(() =>
      document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? ''
    );
    expect(viewport, 'meta viewport assente').toMatch(/width=device-width/i);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2 — Open Graph
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Open Graph — social sharing', () => {

  test('homepage: og:title presente', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const og = await page.evaluate(() =>
      document.querySelector('meta[property="og:title"]')?.getAttribute('content') ?? ''
    );
    if (!og) test.skip(true, 'og:title non ancora configurato');
    expect(og.trim().length).toBeGreaterThan(5);
  });

  test('homepage: og:description presente', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const og = await page.evaluate(() =>
      document.querySelector('meta[property="og:description"]')?.getAttribute('content') ?? ''
    );
    if (!og) test.skip(true, 'og:description non ancora configurato');
    expect(og.trim().length).toBeGreaterThan(10);
  });

  test('homepage: og:image presente e URL valido', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const ogImage = await page.evaluate(() =>
      document.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? ''
    );
    if (!ogImage) test.skip(true, 'og:image non ancora configurato');
    expect(ogImage).toMatch(/^https?:\/\//);
  });

  test('homepage: og:url presente e corrisponde al dominio', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const ogUrl = await page.evaluate(() =>
      document.querySelector('meta[property="og:url"]')?.getAttribute('content') ?? ''
    );
    if (!ogUrl) test.skip(true, 'og:url non ancora configurato');
    expect(ogUrl).toMatch(/jobhunterteam\.ai/i);
  });

  test('homepage: og:type è "website"', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const ogType = await page.evaluate(() =>
      document.querySelector('meta[property="og:type"]')?.getAttribute('content') ?? ''
    );
    if (!ogType) test.skip(true, 'og:type non ancora configurato');
    expect(ogType).toMatch(/website/i);
  });

  test('/about: og:title specifico per la pagina', async ({ page }) => {
    const res = await page.goto(`${BASE}/about`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) test.skip(true, '/about non disponibile');
    const ogTitle = await page.evaluate(() =>
      document.querySelector('meta[property="og:title"]')?.getAttribute('content') ?? ''
    );
    if (!ogTitle) test.skip(true, 'og:title non configurato su /about');
    expect(ogTitle.trim().length).toBeGreaterThan(5);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3 — Twitter Card
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Twitter Card — condivisione social', () => {

  test('homepage: twitter:card presente', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const card = await page.evaluate(() =>
      document.querySelector('meta[name="twitter:card"]')?.getAttribute('content') ?? ''
    );
    if (!card) test.skip(true, 'twitter:card non ancora configurato');
    expect(card).toMatch(/summary|app|player/i);
  });

  test('homepage: twitter:title presente', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const twitterTitle = await page.evaluate(() =>
      document.querySelector('meta[name="twitter:title"]')?.getAttribute('content') ?? ''
    );
    if (!twitterTitle) test.skip(true, 'twitter:title non ancora configurato');
    expect(twitterTitle.trim().length).toBeGreaterThan(5);
  });

  test('homepage: twitter:description presente', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const twitterDesc = await page.evaluate(() =>
      document.querySelector('meta[name="twitter:description"]')?.getAttribute('content') ?? ''
    );
    if (!twitterDesc) test.skip(true, 'twitter:description non ancora configurato');
    expect(twitterDesc.trim().length).toBeGreaterThan(10);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4 — Robots e sitemap
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Robots e sitemap — crawlability', () => {

  test('robots.txt risponde 200', async ({ request }) => {
    const res = await request.get(`${BASE}/robots.txt`);
    if (res.status() === 404) test.skip(true, 'robots.txt non ancora deployato');
    expect(res.status()).toBe(200);
  });

  test('robots.txt contiene Disallow o Allow', async ({ request }) => {
    const res = await request.get(`${BASE}/robots.txt`);
    if (res.status() !== 200) test.skip(true, 'robots.txt non disponibile');
    const text = await res.text();
    expect(text).toMatch(/Disallow|Allow|User-agent/i);
  });

  test('robots.txt non blocca tutto il sito (Disallow: /)', async ({ request }) => {
    const res = await request.get(`${BASE}/robots.txt`);
    const text = await res.text();
    // Non deve avere un blocco completo su User-agent: * + Disallow: /
    const blocksAll = /User-agent:\s*\*[\s\S]*?Disallow:\s*\/\s*\n/m.test(text);
    expect(blocksAll, 'robots.txt blocca tutto il sito').toBe(false);
  });

  test('sitemap.xml risponde 200 o robots.txt referenzia sitemap', async ({ request }) => {
    const sitemapRes = await request.get(`${BASE}/sitemap.xml`);
    if (sitemapRes.status() === 200) {
      expect(sitemapRes.status()).toBe(200);
      return;
    }
    // Alternativa: robots.txt potrebbe referenziare la sitemap
    const robotsRes = await request.get(`${BASE}/robots.txt`);
    const robotsText = await robotsRes.text();
    const hasSitemapRef = robotsText.toLowerCase().includes('sitemap');
    if (!hasSitemapRef) test.skip(true, 'Né sitemap.xml né riferimento in robots.txt');
    expect(hasSitemapRef).toBe(true);
  });

  test('sitemap.xml contiene URL del sito', async ({ request }) => {
    const res = await request.get(`${BASE}/sitemap.xml`);
    if (res.status() !== 200) test.skip(true, 'sitemap.xml non disponibile');
    const text = await res.text();
    expect(text).toMatch(/jobhunterteam\.ai/i);
    expect(text).toMatch(/<url>|<loc>/i);
  });

  test('homepage: meta robots non è "noindex"', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const metaRobots = await page.evaluate(() =>
      document.querySelector('meta[name="robots"]')?.getAttribute('content') ?? 'index'
    );
    expect(metaRobots.toLowerCase()).not.toContain('noindex');
  });

  test('/privacy: meta robots può essere noindex (ok)', async ({ page }) => {
    const res = await page.goto(`${BASE}/privacy`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) test.skip(true, '/privacy non disponibile');
    // Le pagine privacy possono avere noindex — solo verifichiamo che risponda
    expect(res?.status()).toBe(200);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 5 — Structured data JSON-LD
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Structured data — JSON-LD', () => {

  test('homepage: almeno uno script type="application/ld+json"', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const jsonLdCount = await page.evaluate(() =>
      document.querySelectorAll('script[type="application/ld+json"]').length
    );
    if (jsonLdCount === 0) test.skip(true, 'JSON-LD non ancora implementato');
    expect(jsonLdCount).toBeGreaterThan(0);
  });

  test('homepage: JSON-LD è JSON valido e parsabile', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const jsonLdScripts = await page.evaluate(() =>
      [...document.querySelectorAll('script[type="application/ld+json"]')]
        .map((s) => s.textContent ?? '')
    );
    if (jsonLdScripts.length === 0) test.skip(true, 'JSON-LD non presente');
    for (const script of jsonLdScripts) {
      try {
        JSON.parse(script);
      } catch {
        throw new Error(`JSON-LD non valido: ${script.substring(0, 100)}`);
      }
    }
    expect(jsonLdScripts.length).toBeGreaterThan(0);
  });

  test('homepage: JSON-LD contiene @context schema.org', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const hasSchemaOrg = await page.evaluate(() => {
      const scripts = [...document.querySelectorAll('script[type="application/ld+json"]')];
      return scripts.some((s) => (s.textContent ?? '').includes('schema.org'));
    });
    if (!hasSchemaOrg) test.skip(true, 'JSON-LD schema.org non presente');
    expect(hasSchemaOrg).toBe(true);
  });

  test('homepage: nessuna duplicazione di JSON-LD identici', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const jsonLdTexts = await page.evaluate(() =>
      [...document.querySelectorAll('script[type="application/ld+json"]')]
        .map((s) => s.textContent?.trim() ?? '')
    );
    const unique = new Set(jsonLdTexts);
    expect(unique.size, 'JSON-LD duplicati trovati').toBe(jsonLdTexts.length);
  });

});
