import { test, expect } from '@playwright/test';

/**
 * FLUSSO 39 — OG IMAGE E TWITTER IMAGE
 *
 * Next.js App Router genera automaticamente:
 * - /opengraph-image (da web/app/opengraph-image.tsx)
 * - /twitter-image (da web/app/twitter-image.tsx)
 * - /apple-icon (da web/app/apple-icon.tsx)
 * - /icon.svg (da web/app/icon.svg)
 * e serve /manifest.json da web/public/.
 *
 * ⚠️ Qui NON si salta sul 404. Questi asset sono **nel repository**: se una
 * route risponde 404 la risposta giusta è il rosso, non lo skip. La versione
 * precedente di questo file conteneva 21 `test.skip` della forma
 * `if (res.status() === 404) test.skip(...)`: cancellare `opengraph-image.tsx`
 * non produceva un fallimento, produceva sei test saltati con la motivazione
 * «non ancora deployata» — cioè la suite raccontava come stato dell'ambiente
 * ciò che era la sua unica ragione di esistere. È lo stesso difetto che ha
 * reso necessaria la quarantena (i «770 passed» che erano skip).
 *
 * Suite 1: Immagini OG — opengraph-image disponibile e valida
 * Suite 2: Twitter image — disponibile e valida
 * Suite 3: Apple icon e favicon — disponibili
 * Suite 4: Manifest e PWA
 */

// ⚠️ Percorsi **relativi**, mai una costante BASE locale. Qui c'era
// `process.env.BASE_URL || 'https://jobhunterteam.ai'`: senza BASE_URL questo
// file interrogava la **produzione**, cioè uno dei quattro motivi per cui 75
// spec sono finite in quarantena. Costruendo le URL a mano si aggira anche
// `use.baseURL` della config — dove vive la scelta di `localhost` invece di
// `127.0.0.1` (vedi playwright.config.ts:1-25). Con i percorsi relativi la
// destinazione la decide la config, in un punto solo.

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 — Open Graph Image
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Open Graph Image — /opengraph-image', () => {

  test('GET /opengraph-image risponde 200', async ({ request }) => {
    const res = await request.get('/opengraph-image');
    expect(res.status(), 'web/app/opengraph-image.tsx non è servita').toBe(200);
  });

  test('/opengraph-image: Content-Type è image/', async ({ request }) => {
    const res = await request.get('/opengraph-image');
    expect(res.status(), 'web/app/opengraph-image.tsx non è servita').toBe(200);
    const ct = res.headers()['content-type'] ?? '';
    expect(ct, 'OG image non è un\'immagine').toMatch(/^image\//);
  });

  test('/opengraph-image: dimensioni ragionevoli (> 1KB)', async ({ request }) => {
    const res = await request.get('/opengraph-image');
    expect(res.status(), 'web/app/opengraph-image.tsx non è servita').toBe(200);
    const body = await res.body();
    expect(body.length, 'OG image troppo piccola — probabilmente vuota').toBeGreaterThan(1024);
  });

  test('homepage: meta og:image punta a una URL valida', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const ogImage = await page.evaluate(() =>
      document.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? ''
    );
    // Il meta lo genera Next dal file opengraph-image.tsx: se manca, manca il
    // file o la sua registrazione nei metadata — non l'ambiente.
    expect(ogImage, 'og:image assente dal <head>').toMatch(/^https?:\/\//);
  });

  test('homepage: og:image è raggiungibile (200)', async ({ page, request }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const ogImage = await page.evaluate(() =>
      document.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? ''
    );
    expect(ogImage, 'og:image assente dal <head>').toMatch(/^https?:\/\//);
    // Si segue il **percorso**, non l'URL assoluto: `metadataBase` assolutizza
    // og:image sul dominio pubblico quando NEXT_PUBLIC_SITE_URL non è
    // impostata, e seguire quell'URL interrogherebbe la produzione invece del
    // server sotto test — CI rossa per un sito che non c'entra con la PR.
    const { pathname, search } = new URL(ogImage);
    const res = await request.get(`${pathname}${search}`);
    expect(res.status(), `og:image (${pathname}) non è servita`).toBe(200);
  });

  test('homepage: og:image ha dimensioni (width/height meta)', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const ogWidth = await page.evaluate(() =>
      document.querySelector('meta[property="og:image:width"]')?.getAttribute('content') ?? ''
    );
    const ogHeight = await page.evaluate(() =>
      document.querySelector('meta[property="og:image:height"]')?.getAttribute('content') ?? ''
    );
    // Next li deriva dall'export `size` di opengraph-image.tsx: senza, le
    // anteprime social ritagliano l'immagine a caso.
    expect(parseInt(ogWidth), 'og:image:width assente o non numerica').toBeGreaterThan(0);
    expect(parseInt(ogHeight), 'og:image:height assente o non numerica').toBeGreaterThan(0);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2 — Twitter Image
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Twitter Image — /twitter-image', () => {

  test('GET /twitter-image risponde 200', async ({ request }) => {
    const res = await request.get('/twitter-image');
    expect(res.status(), 'web/app/twitter-image.tsx non è servita').toBe(200);
  });

  test('/twitter-image: Content-Type è image/', async ({ request }) => {
    const res = await request.get('/twitter-image');
    expect(res.status(), 'web/app/twitter-image.tsx non è servita').toBe(200);
    const ct = res.headers()['content-type'] ?? '';
    expect(ct, 'twitter-image non è un\'immagine').toMatch(/^image\//);
  });

  test('/twitter-image: dimensioni ragionevoli (> 1KB)', async ({ request }) => {
    const res = await request.get('/twitter-image');
    expect(res.status(), 'web/app/twitter-image.tsx non è servita').toBe(200);
    const body = await res.body();
    expect(body.length, 'twitter-image troppo piccola').toBeGreaterThan(1024);
  });

  test('homepage: meta twitter:image punta a URL valida', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const twitterImage = await page.evaluate(() =>
      document.querySelector('meta[name="twitter:image"]')?.getAttribute('content') ?? ''
    );
    expect(twitterImage, 'twitter:image assente dal <head>').toMatch(/^https?:\/\//);
  });

  test('homepage: twitter:card è "summary_large_image"', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const card = await page.evaluate(() =>
      document.querySelector('meta[name="twitter:card"]')?.getAttribute('content') ?? ''
    );
    // È il tipo dichiarato in web/app/layout.tsx ed è l'unico che mostra
    // l'immagine grande: `summary` la ridurrebbe a una miniatura quadrata.
    expect(card, 'twitter:card diverso da quello dichiarato in layout.tsx').toBe('summary_large_image');
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3 — Apple icon e favicon
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Apple icon e favicon', () => {

  test('GET /apple-icon risponde 200', async ({ request }) => {
    const res = await request.get('/apple-icon');
    expect(res.status(), 'web/app/apple-icon.tsx non è servita').toBe(200);
  });

  test('/apple-icon: Content-Type è image/', async ({ request }) => {
    const res = await request.get('/apple-icon');
    expect(res.status(), 'web/app/apple-icon.tsx non è servita').toBe(200);
    const ct = res.headers()['content-type'] ?? '';
    expect(ct).toMatch(/^image\//);
  });

  test('GET /icon.svg risponde 200', async ({ request }) => {
    const res = await request.get('/icon.svg');
    expect(res.status(), '/icon.svg non è servita').toBe(200);
  });

  test('/icon.svg: Content-Type è image/svg', async ({ request }) => {
    const res = await request.get('/icon.svg');
    expect(res.status(), '/icon.svg non è servita').toBe(200);
    const ct = res.headers()['content-type'] ?? '';
    expect(ct).toMatch(/svg|image/i);
  });

  // Prima qui c'era «GET /favicon.ico risponde (non 500)», che si saltava sul
  // 404 con la motivazione «non presente — usa /icon.svg». Ma /favicon.ico non
  // esiste **per scelta** (il prodotto dichiara icon.svg e le PNG), quindi quel
  // test non poteva far altro che saltarsi: verificava l'assenza di un file che
  // nessuno intende aggiungere. Ciò che vale la pena verificare è che le icone
  // davvero dichiarate si scarichino — un href sbagliato nel <head> è muto in
  // pagina e visibile solo come tab senza icona.
  test('homepage: ogni icona dichiarata nel <head> risponde 200', async ({ page, request }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const hrefs = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]')
      ).map((l) => l.getAttribute('href') ?? '')
    );
    expect(hrefs.length, 'nessun <link rel="icon"> nel <head>').toBeGreaterThan(0);
    for (const href of hrefs) {
      // Come sopra: se l'href è assoluto se ne segue il percorso, così la
      // richiesta resta sul server sotto test.
      const url = href.startsWith('http') ? new URL(href).pathname : href;
      const res = await request.get(url);
      expect(res.status(), `icona dichiarata ma non servita: ${href}`).toBe(200);
    }
  });

  test('homepage: <link rel="icon"> o <link rel="apple-touch-icon"> presente', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const iconLink = await page.evaluate(() => {
      const icon = document.querySelector('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]');
      return icon ? icon.getAttribute('href') : null;
    });
    expect(iconLink, 'nessun <link rel="icon"> nel <head>').toBeTruthy();
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4 — Manifest e PWA
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Manifest e PWA', () => {

  test('GET /manifest.json risponde 200', async ({ request }) => {
    const res = await request.get('/manifest.json');
    expect(res.status(), 'web/public/manifest.json non è servito').toBe(200);
  });

  test('/manifest.json: JSON valido con name e icons', async ({ request }) => {
    const res = await request.get('/manifest.json');
    expect(res.status(), 'web/public/manifest.json non è servito').toBe(200);
    const body = await res.json().catch(() => null);
    expect(body, 'manifest.json non è JSON').not.toBeNull();
    expect(body).toHaveProperty('name');
    // Senza icone il manifest è valido ma inutile: l'installazione PWA non
    // ha nulla da mettere sulla home.
    expect(Array.isArray(body.icons) && body.icons.length > 0, 'manifest senza icone').toBe(true);
  });

  test('homepage: <link rel="manifest"> presente', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const manifest = await page.evaluate(() =>
      document.querySelector('link[rel="manifest"]')?.getAttribute('href') ?? ''
    );
    expect(manifest, 'nessun <link rel="manifest"> nel <head>').toBeTruthy();
  });

  test('homepage: meta theme-color presente', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const themeColor = await page.evaluate(() =>
      document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? ''
    );
    // Deve essere un colore valido (hex, rgb, named)
    expect(themeColor, 'theme-color assente dal <head>').toMatch(/#[0-9a-f]{3,6}|rgb\(|hsl\(|\w+/i);
  });

});
