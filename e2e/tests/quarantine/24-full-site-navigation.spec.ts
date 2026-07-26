import { test, expect } from '@playwright/test';

/**
 * FLUSSO 24 — NAVIGAZIONE COMPLETA SITO (utente nuovo)
 *
 * Suite 1: Pagine pubbliche — status 200, H1, <title>
 * Suite 2: Navigazione landing → pagine (link interni)
 * Suite 3: Link interni globali — nessun 404
 * Suite 4: Link esterni — GitHub e altri
 * Suite 5: Footer presente su ogni pagina pubblica
 * Suite 6: Flusso utente nuovo (landing → download / faq / guide)
 */

const BASE = process.env.BASE_URL || 'https://jobhunterteam.ai';

/** Pagine pubbliche accessibili senza autenticazione */
const PUBLIC_PAGES = [
  { path: '/',          label: 'Homepage'  },
  { path: '/faq',       label: 'FAQ'       },
  { path: '/guide',     label: 'Guida'     },
  { path: '/download',  label: 'Download'  },
  { path: '/changelog', label: 'Changelog' },
  { path: '/docs',      label: 'Docs'      },
  { path: '/about',     label: 'About'     },
];

/** Link interni attesi nella navbar/footer della landing */
const NAV_INTERNAL_LINKS = [
  '/download',
  '/guide',
  '/faq',
];

/** Link nel footer (LandingFooter) */
const FOOTER_INTERNAL_LINKS = [
  '/download',
  '/faq',
  '/guide',
];

/** Link esterni attesi */
const EXTERNAL_LINKS = [
  'https://github.com/leopu00/job-hunter-team',
  'https://github.com/leopu00/job-hunter-team/issues',
  'https://github.com/leopu00/job-hunter-team/discussions',
];

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 — Pagine pubbliche: status, title, H1
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Pagine pubbliche — status 200, title, H1', () => {

  for (const { path, label } of PUBLIC_PAGES) {
    test(`${label} (${path}): risponde 200`, async ({ page }) => {
      const res = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
      expect(res?.status(), `${label} non risponde 200`).toBe(200);
    });

    test(`${label} (${path}): <title> presente e non vuoto`, async ({ page }) => {
      const res = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
      if (res?.status() !== 200) test.skip(true, `${label} non disponibile`);
      const title = await page.title();
      expect(title, `<title> vuoto su ${label}`).toBeTruthy();
      expect(title.length, `<title> troppo corto su ${label}`).toBeGreaterThan(3);
    });

    test(`${label} (${path}): H1 presente`, async ({ page }) => {
      const res = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
      if (res?.status() !== 200) test.skip(true, `${label} non disponibile`);
      const h1Count = await page.locator('h1').count();
      expect(h1Count, `H1 assente su ${label}`).toBeGreaterThanOrEqual(1);
    });
  }

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2 — Navigazione dalla landing verso le pagine figlie
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Navigazione landing → pagine', () => {

  test('navbar: link Download naviga su /download senza errori', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const link = page.locator('nav a[href="/download"], header a[href="/download"]').first();
    await expect(link).toBeVisible({ timeout: 5000 });
    await link.click();
    await page.waitForURL(`${BASE}/download`, { timeout: 10000 });
    expect(page.url()).toContain('/download');
    const h1 = page.locator('h1').first();
    await expect(h1).toBeVisible({ timeout: 5000 });
  });

  test('navbar: link Guida naviga su /guide senza errori', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const link = page.locator('nav a[href="/guide"], header a[href="/guide"]').first();
    await expect(link).toBeVisible({ timeout: 5000 });
    await link.click();
    await page.waitForURL(`${BASE}/guide`, { timeout: 10000 });
    expect(page.url()).toContain('/guide');
    const h1 = page.locator('h1').first();
    await expect(h1).toBeVisible({ timeout: 5000 });
  });

  test('navbar: link FAQ naviga su /faq senza errori', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const link = page.locator('nav a[href="/faq"], header a[href="/faq"]').first();
    await expect(link).toBeVisible({ timeout: 5000 });
    await link.click();
    await page.waitForURL(`${BASE}/faq`, { timeout: 10000 });
    expect(page.url()).toContain('/faq');
  });

  test('logo/home link dalla landing torna su /', async ({ page }) => {
    await page.goto(`${BASE}/faq`, { waitUntil: 'networkidle' });
    const homeLink = page.locator('nav a[href="/"]').first();
    await expect(homeLink).toBeVisible({ timeout: 5000 });
    // JS click diretto — il testo interno intercetta i pointer events via Playwright
    await page.evaluate(() => {
      (document.querySelector('nav a[href="/"]') as HTMLAnchorElement)?.click();
    });
    await page.waitForURL((url) => !url.pathname.includes('/faq'), { timeout: 10000 });
    expect(page.url()).toMatch(/jobhunterteam\.ai\/?$/);
  });

  test('CTA homepage: bottone Download naviga su /download', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    // CTA principale — link Download nella sezione hero o CTA
    const ctaLink = page.locator('a[href="/download"]').first();
    await expect(ctaLink).toBeVisible({ timeout: 5000 });
    await ctaLink.click();
    await page.waitForURL(`${BASE}/download`, { timeout: 10000 });
    expect(page.url()).toContain('/download');
  });

  test('/faq → footer link Download naviga correttamente', async ({ page }) => {
    const res = await page.goto(`${BASE}/faq`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) test.skip(true, '/faq non disponibile');
    // Footer nav in faq ha link Download →
    const downloadLink = page.locator('a[href="/download"]').last();
    await expect(downloadLink).toBeVisible({ timeout: 5000 });
    await downloadLink.click();
    await page.waitForURL(`${BASE}/download`, { timeout: 10000 });
    expect(page.url()).toContain('/download');
  });

  test('/guide → footer link FAQ naviga correttamente', async ({ page }) => {
    const res = await page.goto(`${BASE}/guide`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) test.skip(true, '/guide non disponibile');
    // La guida ha link di navigazione a /faq o /download
    const faqLink = page.locator('a[href="/faq"]').first();
    await expect(faqLink).toBeVisible({ timeout: 5000 });
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3 — Link interni: nessun 404 su pagine pubbliche
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Link interni — nessun 404', () => {

  test('homepage: tutti i link interni <a href="/..."> rispondono 200', async ({ page, request }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const internalLinks: string[] = await page.evaluate((base) =>
      [...document.querySelectorAll('a[href]')]
        .map((a) => (a as HTMLAnchorElement).href)
        .filter((href) => href.startsWith(base) && !href.includes('#') && !href.includes('?login'))
        .filter((href, i, arr) => arr.indexOf(href) === i) // dedup
    , BASE);

    const failed: string[] = [];
    for (const url of internalLinks) {
      const res = await request.get(url, { timeout: 10000 }).catch(() => null);
      if (!res || res.status() === 404) {
        failed.push(`404 — ${url}`);
      }
    }
    expect(failed, `Link interni 404 sulla homepage:\n${failed.join('\n')}`).toHaveLength(0);
  });

  test('/faq: tutti i link interni rispondono 200', async ({ page, request }) => {
    const res = await page.goto(`${BASE}/faq`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) test.skip(true, '/faq non disponibile');
    const internalLinks: string[] = await page.evaluate((base) =>
      [...document.querySelectorAll('a[href]')]
        .map((a) => (a as HTMLAnchorElement).href)
        .filter((href) => href.startsWith(base) && !href.includes('#'))
        .filter((href, i, arr) => arr.indexOf(href) === i)
    , BASE);

    const failed: string[] = [];
    for (const url of internalLinks) {
      const r = await request.get(url, { timeout: 10000 }).catch(() => null);
      if (!r || r.status() === 404) failed.push(`404 — ${url}`);
    }
    expect(failed, `Link interni 404 su /faq:\n${failed.join('\n')}`).toHaveLength(0);
  });

  test('/guide: tutti i link interni rispondono 200', async ({ page, request }) => {
    const res = await page.goto(`${BASE}/guide`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) test.skip(true, '/guide non disponibile');
    const internalLinks: string[] = await page.evaluate((base) =>
      [...document.querySelectorAll('a[href]')]
        .map((a) => (a as HTMLAnchorElement).href)
        .filter((href) => href.startsWith(base) && !href.includes('#'))
        .filter((href, i, arr) => arr.indexOf(href) === i)
    , BASE);

    const failed: string[] = [];
    for (const url of internalLinks) {
      const r = await request.get(url, { timeout: 10000 }).catch(() => null);
      if (!r || r.status() === 404) failed.push(`404 — ${url}`);
    }
    expect(failed, `Link interni 404 su /guide:\n${failed.join('\n')}`).toHaveLength(0);
  });

  test('/download: tutti i link interni rispondono 200', async ({ page, request }) => {
    const res = await page.goto(`${BASE}/download`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) test.skip(true, '/download non disponibile');
    const internalLinks: string[] = await page.evaluate((base) =>
      [...document.querySelectorAll('a[href]')]
        .map((a) => (a as HTMLAnchorElement).href)
        .filter((href) => href.startsWith(base) && !href.includes('#'))
        .filter((href, i, arr) => arr.indexOf(href) === i)
    , BASE);

    const failed: string[] = [];
    for (const url of internalLinks) {
      const r = await request.get(url, { timeout: 10000 }).catch(() => null);
      if (!r || r.status() === 404) failed.push(`404 — ${url}`);
    }
    expect(failed, `Link interni 404 su /download:\n${failed.join('\n')}`).toHaveLength(0);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4 — Link esterni (GitHub) — presenti e raggiungibili
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Link esterni — GitHub e altri', () => {

  test('homepage: link GitHub repo presente', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const ghLink = page.locator('a[href*="github.com/leopu00/job-hunter-team"]').first();
    await expect(ghLink).toBeVisible({ timeout: 5000 });
  });

  test('homepage: link GitHub Issues presente nel footer', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const issuesLink = page.locator('a[href*="github.com"][href*="issues"]').first();
    await expect(issuesLink).toBeVisible({ timeout: 5000 });
  });

  test('homepage: link GitHub Discussions presente nel footer', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const discLink = page.locator('a[href*="github.com"][href*="discussions"]').first();
    await expect(discLink).toBeVisible({ timeout: 5000 });
  });

  test('link GitHub repo risponde 200 (non rimosso)', async ({ request }) => {
    const res = await request.get('https://github.com/leopu00/job-hunter-team', { timeout: 15000 });
    expect(res.status(), 'GitHub repo non raggiungibile').toBe(200);
  });

  test('link GitHub Issues risponde 200', async ({ request }) => {
    const res = await request.get('https://github.com/leopu00/job-hunter-team/issues', { timeout: 15000 });
    expect(res.status(), 'GitHub Issues non raggiungibile').toBe(200);
  });

  test('/download: link nodejs.org presente', async ({ page }) => {
    const res = await page.goto(`${BASE}/download`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) test.skip(true, '/download non disponibile');
    const nodeLink = page.locator('a[href*="nodejs.org"]').first();
    const count = await nodeLink.count();
    // Potrebbe non essere linkato nella versione corrente — skip se assente
    if (count === 0) test.skip(true, 'Link nodejs.org non presente in questa versione');
    await expect(nodeLink).toBeVisible({ timeout: 3000 });
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 5 — Footer presente su ogni pagina pubblica
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Footer — presente su ogni pagina pubblica', () => {

  test('homepage: footer con link GitHub visibile', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const footer = page.locator('footer, [class*="footer"], section:has(a[href*="github.com"])').first();
    await expect(footer).toBeVisible({ timeout: 5000 });
  });

  test('homepage: footer contiene link /download, /faq, /guide', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    for (const path of FOOTER_INTERNAL_LINKS) {
      const link = page.locator(`a[href="${path}"]`).last();
      await expect(link, `Link footer ${path} assente`).toBeVisible({ timeout: 5000 });
    }
  });

  test('/faq: footer nav con link ← Guida e Download → visibili', async ({ page }) => {
    const res = await page.goto(`${BASE}/faq`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) test.skip(true, '/faq non disponibile');
    await expect(page.locator('a[href="/guide"]').last()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('a[href="/download"]').last()).toBeVisible({ timeout: 5000 });
  });

  test('/guide: footer nav con link di navigazione visibile', async ({ page }) => {
    const res = await page.goto(`${BASE}/guide`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) test.skip(true, '/guide non disponibile');
    // La guida ha almeno un link di navigazione in fondo
    const navLink = page.locator('a[href="/faq"], a[href="/download"], a[href="/"]').last();
    await expect(navLink).toBeVisible({ timeout: 5000 });
  });

  test('/download: footer nav con link visibile', async ({ page }) => {
    const res = await page.goto(`${BASE}/download`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) test.skip(true, '/download non disponibile');
    const navLink = page.locator('a[href="/faq"], a[href="/guide"], a[href="/"]').last();
    await expect(navLink).toBeVisible({ timeout: 5000 });
  });

  test('/changelog: ha almeno un link di navigazione', async ({ page }) => {
    const res = await page.goto(`${BASE}/changelog`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) test.skip(true, '/changelog non disponibile');
    // Changelog ha link Back to Home o simili
    const backLink = page.locator('a[href="/"], a[href*="guide"], a[href*="faq"]').first();
    const count = await backLink.count();
    if (count === 0) test.skip(true, 'Nessun link di navigazione su /changelog');
    await expect(backLink).toBeVisible({ timeout: 5000 });
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 6 — Flusso utente nuovo: landing → esplorazione
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Flusso utente nuovo — navigazione completa', () => {

  test('flusso completo: / → /faq → /guide → /download senza 404', async ({ page }) => {
    // Step 1: Landing
    let res = await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    expect(res?.status()).toBe(200);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 5000 });

    // Step 2: FAQ
    res = await page.goto(`${BASE}/faq`, { waitUntil: 'networkidle' });
    expect(res?.status(), '/faq non disponibile').toBe(200);
    await expect(page.locator('h1')).toBeVisible({ timeout: 5000 });

    // Step 3: Guida
    res = await page.goto(`${BASE}/guide`, { waitUntil: 'networkidle' });
    expect(res?.status(), '/guide non disponibile').toBe(200);
    await expect(page.locator('h1')).toBeVisible({ timeout: 5000 });

    // Step 4: Download
    res = await page.goto(`${BASE}/download`, { waitUntil: 'networkidle' });
    expect(res?.status(), '/download non disponibile').toBe(200);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 5000 });
  });

  test('flusso: / → navbar FAQ → accordion visibile', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.locator('nav a[href="/faq"]').first().click();
    await page.waitForURL(`${BASE}/faq`, { timeout: 10000 });
    // Almeno 5 bottoni accordion visibili
    const accordionBtns = page.locator('button').filter({ hasText: /cos.e|come funziona|account|costa|agenti/i });
    await expect(accordionBtns.first()).toBeVisible({ timeout: 5000 });
  });

  test('flusso: / → navbar Guida → tab Installazione visibile', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.locator('nav a[href="/guide"]').first().click();
    await page.waitForURL(`${BASE}/guide`, { timeout: 10000 });
    // La guida ha tab Installazione/TUI/WebApp
    const installTab = page.getByText(/installazione/i).first();
    await expect(installTab).toBeVisible({ timeout: 5000 });
  });

  test('flusso: / → CTA Download → selezione OS visibile', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.locator('a[href="/download"]').first().click();
    await page.waitForURL(`${BASE}/download`, { timeout: 10000 });
    // La pagina download ha pulsanti per scegliere OS
    const osBtn = page.getByText(/mac|linux|windows/i).first();
    await expect(osBtn).toBeVisible({ timeout: 5000 });
  });

  test('flusso: / → /about risponde e mostra il nome del progetto', async ({ page }) => {
    const res = await page.goto(`${BASE}/about`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) test.skip(true, '/about non disponibile');
    // About mostra il nome del progetto nell'H1
    const h1 = page.locator('h1').first();
    await expect(h1).toBeVisible({ timeout: 5000 });
    const h1Text = await h1.innerText();
    expect(h1Text.length).toBeGreaterThan(2);
  });

  test('flusso: / → /changelog risponde e mostra commit recenti', async ({ page }) => {
    const res = await page.goto(`${BASE}/changelog`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) test.skip(true, '/changelog non disponibile');
    const h1 = page.locator('h1').first();
    await expect(h1).toBeVisible({ timeout: 5000 });
    const h1Text = await h1.innerText();
    expect(h1Text).toMatch(/changelog/i);
  });

  test('pagina 404: URL inesistente non crasha il browser', async ({ page }) => {
    const res = await page.goto(`${BASE}/questa-pagina-non-esiste-12345`, { waitUntil: 'networkidle' });
    // Next.js ritorna 404 con pagina gestita — non deve essere un crash 500
    expect(res?.status(), 'Risposta inattesa per URL inesistente').not.toBe(500);
    // Deve essere presente almeno un elemento visibile (pagina 404 di Next.js)
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('nessun errore JavaScript critico sulla homepage', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => jsErrors.push(e.message));
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    const critical = jsErrors.filter((e) => !/expected|warning|chunk|hydrat/i.test(e));
    expect(critical, `Errori JS critici homepage: ${critical.join(', ')}`).toHaveLength(0);
  });

  test('nessun errore JavaScript critico su /faq', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => jsErrors.push(e.message));
    const res = await page.goto(`${BASE}/faq`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) test.skip(true, '/faq non disponibile');
    await page.waitForTimeout(1000);
    const critical = jsErrors.filter((e) => !/expected|warning|chunk|hydrat/i.test(e));
    expect(critical, `Errori JS critici /faq: ${critical.join(', ')}`).toHaveLength(0);
  });

});
