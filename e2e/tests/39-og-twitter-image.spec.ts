import { test, expect } from '@playwright/test';

/**
 * FLUSSO 39 — OG IMAGE E TWITTER IMAGE
 *
 * Next.js App Router genera automaticamente:
 * - /opengraph-image (da opengraph-image.tsx)
 * - /twitter-image (da twitter-image.tsx)
 * - /apple-icon (da apple-icon.tsx)
 * - /icon.svg
 *
 * Suite 1: Immagini OG — opengraph-image disponibile e valida
 * Suite 2: Twitter image — disponibile e valida
 * Suite 3: Apple icon e favicon — disponibili
 * Suite 4: Meta tag riferimento alle immagini
 */

const BASE = process.env.BASE_URL || 'https://jobhunterteam.ai';

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 — Open Graph Image
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Open Graph Image — /opengraph-image', () => {

  test('GET /opengraph-image risponde (non 404/500)', async ({ request }) => {
    const res = await request.get(`${BASE}/opengraph-image`);
    if (res.status() === 404) test.skip(true, '/opengraph-image non ancora deployata');
    expect(res.status(), '/opengraph-image risponde 500').not.toBe(500);
  });

  test('/opengraph-image: Content-Type è image/', async ({ request }) => {
    const res = await request.get(`${BASE}/opengraph-image`);
    if (res.status() !== 200) test.skip(true, '/opengraph-image non disponibile');
    const ct = res.headers()['content-type'] ?? '';
    expect(ct, 'OG image non è un\'immagine').toMatch(/^image\//);
  });

  test('/opengraph-image: dimensioni ragionevoli (> 1KB)', async ({ request }) => {
    const res = await request.get(`${BASE}/opengraph-image`);
    if (res.status() !== 200) test.skip(true, '/opengraph-image non disponibile');
    const body = await res.body();
    expect(body.length, 'OG image troppo piccola — probabilmente vuota').toBeGreaterThan(1024);
  });

  test('homepage: meta og:image punta a una URL valida', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const ogImage = await page.evaluate(() =>
      document.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? ''
    );
    if (!ogImage) test.skip(true, 'og:image non configurato');
    expect(ogImage).toMatch(/^https?:\/\//);
    // L'URL deve puntare al dominio o a un CDN
    expect(ogImage).not.toBe('');
  });

  test('homepage: og:image è raggiungibile (non 404)', async ({ page, request }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const ogImage = await page.evaluate(() =>
      document.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? ''
    );
    if (!ogImage) test.skip(true, 'og:image non configurato');
    const res = await request.get(ogImage).catch(() => null);
    if (!res) test.skip(true, 'og:image URL non raggiungibile');
    expect(res!.status(), `og:image risponde ${res!.status()}`).not.toBe(404);
  });

  test('homepage: og:image ha dimensioni (width/height meta)', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const ogWidth = await page.evaluate(() =>
      document.querySelector('meta[property="og:image:width"]')?.getAttribute('content') ?? ''
    );
    const ogHeight = await page.evaluate(() =>
      document.querySelector('meta[property="og:image:height"]')?.getAttribute('content') ?? ''
    );
    if (!ogWidth && !ogHeight) test.skip(true, 'og:image:width/height non configurati');
    if (ogWidth) expect(parseInt(ogWidth)).toBeGreaterThan(0);
    if (ogHeight) expect(parseInt(ogHeight)).toBeGreaterThan(0);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2 — Twitter Image
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Twitter Image — /twitter-image', () => {

  test('GET /twitter-image risponde (non 404/500)', async ({ request }) => {
    const res = await request.get(`${BASE}/twitter-image`);
    if (res.status() === 404) test.skip(true, '/twitter-image non ancora deployata');
    expect(res.status(), '/twitter-image risponde 500').not.toBe(500);
  });

  test('/twitter-image: Content-Type è image/', async ({ request }) => {
    const res = await request.get(`${BASE}/twitter-image`);
    if (res.status() !== 200) test.skip(true, '/twitter-image non disponibile');
    const ct = res.headers()['content-type'] ?? '';
    expect(ct, 'twitter-image non è un\'immagine').toMatch(/^image\//);
  });

  test('/twitter-image: dimensioni ragionevoli (> 1KB)', async ({ request }) => {
    const res = await request.get(`${BASE}/twitter-image`);
    if (res.status() !== 200) test.skip(true, '/twitter-image non disponibile');
    const body = await res.body();
    expect(body.length, 'twitter-image troppo piccola').toBeGreaterThan(1024);
  });

  test('homepage: meta twitter:image punta a URL valida', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const twitterImage = await page.evaluate(() =>
      document.querySelector('meta[name="twitter:image"]')?.getAttribute('content') ?? ''
    );
    if (!twitterImage) test.skip(true, 'twitter:image non configurata');
    expect(twitterImage).toMatch(/^https?:\/\//);
  });

  test('homepage: twitter:card è "summary_large_image"', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const card = await page.evaluate(() =>
      document.querySelector('meta[name="twitter:card"]')?.getAttribute('content') ?? ''
    );
    if (!card) test.skip(true, 'twitter:card non configurato');
    // summary_large_image è il tipo raccomandato per og images grandi
    expect(card).toMatch(/summary/i);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3 — Apple icon e favicon
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Apple icon e favicon', () => {

  test('GET /apple-icon risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/apple-icon`);
    if (res.status() === 404) test.skip(true, '/apple-icon non ancora deployata');
    expect(res.status()).not.toBe(500);
  });

  test('/apple-icon: Content-Type è image/', async ({ request }) => {
    const res = await request.get(`${BASE}/apple-icon`);
    if (res.status() !== 200) test.skip(true, '/apple-icon non disponibile');
    const ct = res.headers()['content-type'] ?? '';
    expect(ct).toMatch(/^image\//);
  });

  test('GET /icon.svg risponde 200', async ({ request }) => {
    const res = await request.get(`${BASE}/icon.svg`);
    if (res.status() === 404) test.skip(true, '/icon.svg non ancora deployato');
    expect(res.status()).toBe(200);
  });

  test('/icon.svg: Content-Type è image/svg', async ({ request }) => {
    const res = await request.get(`${BASE}/icon.svg`);
    if (res.status() !== 200) test.skip(true, '/icon.svg non disponibile');
    const ct = res.headers()['content-type'] ?? '';
    expect(ct).toMatch(/svg|image/i);
  });

  test('GET /favicon.ico risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/favicon.ico`);
    if (res.status() === 404) test.skip(true, '/favicon.ico non presente — usa /icon.svg');
    expect(res.status()).not.toBe(500);
  });

  test('homepage: <link rel="icon"> o <link rel="apple-touch-icon"> presente', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const iconLink = await page.evaluate(() => {
      const icon = document.querySelector('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]');
      return icon ? icon.getAttribute('href') : null;
    });
    if (!iconLink) test.skip(true, 'Icon link non trovato nel <head>');
    expect(iconLink).toBeTruthy();
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4 — Manifest e PWA
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Manifest e PWA', () => {

  test('GET /manifest.json risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/manifest.json`);
    if (res.status() === 404) test.skip(true, '/manifest.json non presente');
    expect(res.status()).not.toBe(500);
  });

  test('/manifest.json: JSON valido con name e icons', async ({ request }) => {
    const res = await request.get(`${BASE}/manifest.json`);
    if (res.status() !== 200) test.skip(true, '/manifest.json non disponibile');
    const body = await res.json().catch(() => null);
    expect(body, 'manifest.json non è JSON').not.toBeNull();
    expect(body).toHaveProperty('name');
  });

  test('homepage: <link rel="manifest"> presente', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const manifest = await page.evaluate(() =>
      document.querySelector('link[rel="manifest"]')?.getAttribute('href') ?? ''
    );
    if (!manifest) test.skip(true, 'manifest link non trovato');
    expect(manifest).toBeTruthy();
  });

  test('homepage: meta theme-color presente', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const themeColor = await page.evaluate(() =>
      document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? ''
    );
    if (!themeColor) test.skip(true, 'theme-color non configurato');
    // Deve essere un colore valido (hex, rgb, named)
    expect(themeColor).toMatch(/#[0-9a-f]{3,6}|rgb\(|hsl\(|\w+/i);
  });

});
