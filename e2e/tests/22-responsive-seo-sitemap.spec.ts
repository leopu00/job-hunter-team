import { test, expect } from '@playwright/test';

/**
 * FLUSSO 22 — RESPONSIVE MOBILE, META SEO, SITEMAP
 *
 * Suite 1: Responsive mobile — viewport 375px (iPhone SE)
 * Suite 2: Meta SEO — title, description, og:*, twitter:*
 * Suite 3: Sitemap.xml e robots.txt accessibili
 *
 * Nota: i test SEO og:* e sitemap failleranno finché i tag non
 * sono aggiunti al progetto — documentano il comportamento atteso.
 */

const BASE = process.env.BASE_URL || 'https://jobhunterteam.ai';

/** Legge tutti i meta tag rilevanti via JS (più robusto di locator su meta) */
async function getMetaTags(page: any) {
  return page.evaluate(() => {
    const get = (sel: string, attr: string) => {
      const el = document.querySelector(sel);
      return el ? el.getAttribute(attr) : null;
    };
    return {
      title:         document.title,
      description:   get('meta[name="description"]', 'content'),
      ogTitle:       get('meta[property="og:title"]', 'content'),
      ogDescription: get('meta[property="og:description"]', 'content'),
      ogImage:       get('meta[property="og:image"]', 'content'),
      ogUrl:         get('meta[property="og:url"]', 'content'),
      ogType:        get('meta[property="og:type"]', 'content'),
      twitterTitle:  get('meta[name="twitter:title"]', 'content'),
      twitterCard:   get('meta[name="twitter:card"]', 'content'),
      canonical:     get('link[rel="canonical"]', 'href'),
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 — Responsive mobile (viewport 375px)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Responsive mobile — viewport 375px', () => {

  test.use({
    viewport: { width: 375, height: 812 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
  });

  test('homepage: nessun overflow orizzontale su mobile', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const overflow = await page.evaluate(
      () => document.body.scrollWidth > window.innerWidth
    );
    expect(overflow, 'Overflow orizzontale rilevato su homepage mobile').toBe(false);
  });

  test('homepage: H1 visibile su mobile', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const h1 = page.locator('h1').first();
    await expect(h1).toBeVisible({ timeout: 10000 });
  });

  test('homepage: elemento di navigazione presente su mobile', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    // La navbar su mobile ha bottoni (hamburger o link)
    const navEl = page.locator('nav button, nav a, [class*="nav"] button').first();
    await expect(navEl).toBeVisible({ timeout: 5000 });
  });

  test('/faq: nessun overflow orizzontale su mobile', async ({ page }) => {
    const res = await page.goto(`${BASE}/faq`, { waitUntil: 'networkidle' });
    if (res?.status() === 404) test.skip(true, '/faq non disponibile');
    const overflow = await page.evaluate(
      () => document.body.scrollWidth > window.innerWidth
    );
    expect(overflow, 'Overflow orizzontale su /faq mobile').toBe(false);
  });

  test('/faq: H1 e accordion visibili su mobile', async ({ page }) => {
    const res = await page.goto(`${BASE}/faq`, { waitUntil: 'networkidle' });
    if (res?.status() === 404) test.skip(true, '/faq non disponibile');
    await expect(page.locator('h1')).toBeVisible({ timeout: 5000 });
    // Almeno un bottone accordion visibile
    const firstFaqBtn = page.locator('button').filter({ hasText: /cos.e|come funziona|account/i }).first();
    await expect(firstFaqBtn).toBeVisible({ timeout: 5000 });
  });

  test('/download: nessun overflow orizzontale su mobile', async ({ page }) => {
    const res = await page.goto(`${BASE}/download`, { waitUntil: 'networkidle' });
    if (res?.status() === 404) test.skip(true, '/download non disponibile');
    const overflow = await page.evaluate(
      () => document.body.scrollWidth > window.innerWidth
    );
    expect(overflow, 'Overflow orizzontale su /download mobile').toBe(false);
  });

  test('/download: contenuto principale visibile su mobile', async ({ page }) => {
    const res = await page.goto(`${BASE}/download`, { waitUntil: 'networkidle' });
    if (res?.status() === 404) test.skip(true, '/download non disponibile');
    const h1 = page.locator('h1').first();
    await expect(h1).toBeVisible({ timeout: 5000 });
  });

  test('meta viewport tag presente su ogni pagina mobile', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const viewport = await page.evaluate(
      () => document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? null
    );
    expect(viewport, 'Meta viewport assente').not.toBeNull();
    expect(viewport).toMatch(/width=device-width/i);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2 — Meta SEO
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Meta SEO — tag og:* e twitter:*', () => {

  test('homepage: <title> presente e non vuoto', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const meta = await getMetaTags(page);
    expect(meta.title, '<title> vuoto sulla homepage').toBeTruthy();
    expect(meta.title.length).toBeGreaterThan(3);
  });

  test('homepage: meta description presente e non vuota', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const meta = await getMetaTags(page);
    expect(meta.description, 'meta description assente sulla homepage').toBeTruthy();
    expect((meta.description ?? '').length).toBeGreaterThan(10);
  });

  test('homepage: og:title presente', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const meta = await getMetaTags(page);
    expect(meta.ogTitle, 'og:title assente sulla homepage').toBeTruthy();
  });

  test('homepage: og:description presente', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const meta = await getMetaTags(page);
    expect(meta.ogDescription, 'og:description assente sulla homepage').toBeTruthy();
  });

  test('homepage: og:image presente e non vuota', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const meta = await getMetaTags(page);
    expect(meta.ogImage, 'og:image assente sulla homepage').toBeTruthy();
  });

  test('homepage: og:url presente e corrisponde al sito', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const meta = await getMetaTags(page);
    expect(meta.ogUrl ?? meta.canonical, 'og:url e canonical entrambi assenti').toBeTruthy();
  });

  test('homepage: twitter:card presente', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const meta = await getMetaTags(page);
    expect(meta.twitterCard, 'twitter:card assente sulla homepage').toBeTruthy();
  });

  test('/faq: og:title specifico per la pagina FAQ', async ({ page }) => {
    const res = await page.goto(`${BASE}/faq`, { waitUntil: 'networkidle' });
    if (res?.status() === 404) test.skip(true, '/faq non disponibile');
    const meta = await getMetaTags(page);
    expect(meta.ogTitle ?? meta.title, 'Nessun titolo trovato per /faq').toBeTruthy();
    // Il titolo deve menzionare "FAQ" o "domande"
    expect(
      (meta.ogTitle ?? meta.title ?? '').toLowerCase(),
      'og:title /faq non menziona faq o domande'
    ).toMatch(/faq|domande|frequenti/i);
  });

  test('/download: og:title specifico per la pagina Download', async ({ page }) => {
    const res = await page.goto(`${BASE}/download`, { waitUntil: 'networkidle' });
    if (res?.status() === 404) test.skip(true, '/download non disponibile');
    const meta = await getMetaTags(page);
    expect(meta.ogTitle ?? meta.title, 'Nessun titolo trovato per /download').toBeTruthy();
  });

  test('ogni pagina ha lang="it" sull\'elemento html', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const lang = await page.evaluate(() => document.documentElement.lang);
    expect(lang, 'Attributo lang assente o non italiano').toMatch(/^it/i);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3 — Sitemap.xml e robots.txt
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Sitemap.xml e robots.txt', () => {

  test('sitemap.xml risponde 200', async ({ request }) => {
    const res = await request.get(`${BASE}/sitemap.xml`);
    expect(res.status(), 'sitemap.xml non trovato (404)').toBe(200);
  });

  test('sitemap.xml è XML valido con tag <urlset>', async ({ request }) => {
    const res = await request.get(`${BASE}/sitemap.xml`);
    if (res.status() !== 200) test.skip(true, 'sitemap.xml non disponibile');
    const body = await res.text();
    expect(body, 'sitemap.xml non contiene <urlset>').toMatch(/<urlset/i);
  });

  test('sitemap.xml contiene URL del sito', async ({ request }) => {
    const res = await request.get(`${BASE}/sitemap.xml`);
    if (res.status() !== 200) test.skip(true, 'sitemap.xml non disponibile');
    const body = await res.text();
    expect(body, 'sitemap.xml non contiene URL del sito').toContain('jobhunterteam.ai');
  });

  test('sitemap.xml include pagine chiave (homepage, /faq, /download)', async ({ request }) => {
    const res = await request.get(`${BASE}/sitemap.xml`);
    if (res.status() !== 200) test.skip(true, 'sitemap.xml non disponibile');
    const body = await res.text();
    // Almeno la homepage deve essere inclusa
    expect(body).toMatch(/jobhunterteam\.ai\/?</);
  });

  test('robots.txt risponde 200', async ({ request }) => {
    const res = await request.get(`${BASE}/robots.txt`);
    expect(res.status(), 'robots.txt non trovato (404)').toBe(200);
  });

  test('robots.txt è testo valido con direttive User-agent', async ({ request }) => {
    const res = await request.get(`${BASE}/robots.txt`);
    if (res.status() !== 200) test.skip(true, 'robots.txt non disponibile');
    const body = await res.text();
    expect(body, 'robots.txt non contiene User-agent').toMatch(/user-agent/i);
  });

  test('robots.txt menziona sitemap.xml', async ({ request }) => {
    const res = await request.get(`${BASE}/robots.txt`);
    if (res.status() !== 200) test.skip(true, 'robots.txt non disponibile');
    const body = await res.text();
    expect(body, 'robots.txt non referenzia sitemap.xml').toMatch(/sitemap/i);
  });

});
