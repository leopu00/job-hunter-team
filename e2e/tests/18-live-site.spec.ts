import { test, expect } from '@playwright/test';

/**
 * FLUSSO 18 — SITO LIVE jobhunterteam.ai
 * Copre: landing page (hero/features/CTA/footer), login via /?login=true,
 * pagina /download con 3 card OS, navigazione, responsive mobile.
 * Eseguire con BASE_URL=<url> per testare un deploy specifico.
 */

const BASE = process.env.BASE_URL || 'https://jobhunterteam.ai';

// ─────────────────────────────────────────────────────────────────────────────
// LANDING PAGE
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Landing page pubblica', () => {

  test('home carica con status 200 e titolo corretto', async ({ page }) => {
    const res = await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    expect(res?.status()).toBe(200);
    await expect(page).toHaveTitle('Job Hunter Team');
  });

  test('hero — H1 e tagline visibili', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    const h1 = page.locator('h1').first();
    await expect(h1).toBeVisible({ timeout: 10000 });
    const h1Text = await h1.textContent();
    expect(h1Text?.trim().length).toBeGreaterThan(5);
  });

  test('hero — CTA button/link visibile e cliccabile', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    // CTA può essere link a login, download o sign-up
    const cta = page.locator(
      'a[href*="login"], a[href*="download"], a[href*="sign"], ' +
      'button:text-matches("inizia|download|accedi|get started|prova", "i")'
    ).first();
    await expect(cta).toBeVisible({ timeout: 10000 });
  });

  test('sezione features — almeno 3 card/item visibili', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    // Cerca la sezione features per ID o per contenuto H2
    const featuresSection = page.locator(
      '#features, [data-section="features"], ' +
      'section:has(h2:text-matches("feature|caratteristiche|tutto ciò", "i"))'
    ).first();
    await expect(featuresSection).toBeVisible({ timeout: 10000 });

    // Verifica che ci siano almeno 3 elementi nella sezione
    const items = featuresSection.locator('li, [class*="card"], [class*="feature"], article');
    await expect(items).toHaveCount(3, { timeout: 5000 }).catch(async () => {
      // fallback: conta i paragrafi nella sezione se non ci sono card esplicite
      const paras = await featuresSection.locator('p').count();
      expect(paras).toBeGreaterThanOrEqual(3);
    });
  });

  test('sezione "Come funziona" / how-it-works visibile', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    const section = page.locator(
      '#how-it-works, [data-section="how-it-works"], ' +
      'section:has(h2:text-matches("come funziona|how it works", "i")), ' +
      'h2:text-matches("come funziona|how it works", "i")'
    ).first();
    await expect(section).toBeVisible({ timeout: 10000 });
  });

  test('sezione CTA finale — testo e link presenti', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    // Scorri fino in fondo per attivare lazy load
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);

    const cta = page.locator(
      '#cta, [data-section="cta"], ' +
      'section:has(h2:text-matches("pronto|ready|rivoluzionare|inizia", "i"))'
    ).first();
    await expect(cta).toBeVisible({ timeout: 10000 });
  });

  test('footer presente nella pagina', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
    await expect(page.locator('footer').first()).toBeVisible({ timeout: 10000 });
  });

  test('nessun errore 4xx/5xx nella home', async ({ page }) => {
    const errors: string[] = [];
    page.on('response', (res) => {
      if (res.status() >= 400) errors.push(`${res.status()} ${res.url()}`);
    });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    // Tolleriamo solo errori su risorse esterne (es. analytics)
    const criticalErrors = errors.filter(e => e.includes('jobhunterteam.ai'));
    expect(criticalErrors, `Errori HTTP: ${criticalErrors.join(', ')}`).toHaveLength(0);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// LOGIN — /?login=true
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Login via /?login=true', () => {

  test('/?login=true carica con status 200', async ({ page }) => {
    const res = await page.goto(`${BASE}/?login=true`, { waitUntil: 'domcontentloaded' });
    expect(res?.status()).toBe(200);
  });

  test('/?login=true mostra form di accesso (OAuth o workspace selector)', async ({ page }) => {
    await page.goto(`${BASE}/?login=true`, { waitUntil: 'networkidle' });
    // Il form di accesso può essere OAuth Google (produzione) o workspace selector (deploy locale)
    const accessForm = page.getByText('Login with Google')
      .or(page.getByText(/workspace/i))
      .or(page.getByText(/sfoglia/i))
      .or(page.getByText(/seleziona.*cartella/i))
      .or(page.getByText(/accesso/i));
    await expect(accessForm.first()).toBeVisible({ timeout: 10000 });
  });

  test('/?login=true — messaggio di rassicurazione privacy visibile', async ({ page }) => {
    await page.goto(`${BASE}/?login=true`, { waitUntil: 'networkidle' });
    // OAuth: "Nessuna password memorizzata" / locale: "I tuoi dati restano sul tuo computer"
    const msg = page.getByText(/nessuna password|dati restano|privacy|sicuro/i);
    await expect(msg.first()).toBeVisible({ timeout: 10000 });
  });

  test('/?login=true OAuth — click su "Login with Google" avvia redirect', async ({ page }) => {
    await page.goto(`${BASE}/?login=true`, { waitUntil: 'networkidle' });
    const btn = page.getByText('Login with Google');
    const isOAuth = await btn.count() > 0;
    if (!isOAuth) {
      // Deploy locale con workspace selector — test non applicabile
      test.skip();
      return;
    }
    await expect(btn).toBeVisible({ timeout: 10000 });
    const [_response] = await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
      btn.click(),
    ]);
    expect(page.url()).toMatch(/accounts\.google\.com|supabase\.co\/auth|jobhunterteam\.ai\/auth/);
  });

  test('/?login=true mostra la login view, mentre / resta la landing pubblica', async ({ page }) => {
    await page.goto(`${BASE}/?login=true`, { waitUntil: 'networkidle' });
    const textWithParam = await page.locator('body').innerText();
    expect(textWithParam.includes('Login with Google')).toBe(true);

    await page.goto(BASE, { waitUntil: 'networkidle' });
    const textWithout = await page.locator('body').innerText();

    expect(textWithout.includes('Login with Google')).toBe(false);
    expect(textWithout).toMatch(/Job Hunter Team|Features|How it works|Come funziona/i);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// PAGINA /download
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Pagina /download', () => {

  test('/download carica con status 200 (non 404)', async ({ page }) => {
    const res = await page.goto(`${BASE}/download`, { waitUntil: 'domcontentloaded' });
    const status = res?.status();
    expect(status, `/download ha restituito ${status}`).toBe(200);
  });

  test('/download mostra 3 card OS (Mac, Windows, Linux)', async ({ page }) => {
    await page.goto(`${BASE}/download`, { waitUntil: 'networkidle' });

    // Verifica le 3 piattaforme — almeno una forma di ciascuna deve essere visibile
    await expect(
      page.getByText(/mac|macos/i).or(page.locator('[data-os="mac"]')).first()
    ).toBeVisible({ timeout: 10000 });

    await expect(
      page.getByText(/windows/i).or(page.locator('[data-os="windows"]')).first()
    ).toBeVisible({ timeout: 10000 });

    await expect(
      page.getByText(/linux/i).or(page.locator('[data-os="linux"]')).first()
    ).toBeVisible({ timeout: 10000 });
  });

  test('/download — bottoni/link di download presenti (almeno 1)', async ({ page }) => {
    await page.goto(`${BASE}/download`, { waitUntil: 'networkidle' });
    const downloadLinks = page.locator(
      'a[href$=".dmg"], a[href$=".exe"], a[href$=".AppImage"], a[href$=".deb"], ' +
      'a[href$=".tar.gz"], a[download], ' +
      'button:text-matches("scarica|download", "i"), ' +
      'a:text-matches("scarica|download", "i")'
    );
    await expect(downloadLinks.first()).toBeVisible({ timeout: 10000 });
  });

  test('/download mostra versione del software', async ({ page }) => {
    await page.goto(`${BASE}/download`, { waitUntil: 'networkidle' });
    const body = await page.locator('body').innerText();
    // Versione nel formato v0.x.x o simile
    expect(body).toMatch(/v\d+\.\d+|version|versione/i);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// NAVIGAZIONE
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Navigazione', () => {

  test('navbar/header presente nella home', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    const nav = page.locator('header, nav, [role="navigation"]').first();
    await expect(nav).toBeVisible({ timeout: 10000 });
  });

  test('link alla pagina /download nella navbar o homepage', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    const downloadLink = page.locator('a[href="/download"], a[href*="/download"]').first();
    await expect(downloadLink).toBeVisible({ timeout: 10000 });
  });

  test('link a /?login=true o /login nella homepage', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    const loginLink = page.locator(
      'a[href*="login"], a[href*="accedi"], button:text-matches("accedi|login|inizia", "i")'
    ).first();
    await expect(loginLink).toBeVisible({ timeout: 10000 });
  });

  test('clic su link /download naviga correttamente', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    const downloadLink = page.locator('a[href="/download"], a[href*="/download"]').first();

    if (await downloadLink.count() > 0) {
      await Promise.all([
        page.waitForURL(/\/download/, { timeout: 10000 }),
        downloadLink.click(),
      ]);
      expect(page.url()).toContain('/download');
    } else {
      test.skip();
    }
  });

  test('scroll fluido tra le sezioni della landing', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'networkidle' });

    // Scorri dall'inizio alla fine e verifica che la pagina non si rompa
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
    await page.waitForTimeout(300);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
    await page.evaluate(() => window.scrollTo(0, 0));

    // La pagina è ancora funzionante
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 5000 });
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// RESPONSIVE MOBILE
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Responsive mobile', () => {

  test.use({ viewport: { width: 390, height: 844 } }); // iPhone 14

  test('landing home carica su viewport mobile', async ({ page }) => {
    const res = await page.goto(BASE, { waitUntil: 'networkidle' });
    expect(res?.status()).toBe(200);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 10000 });
  });

  test('hero visibile su mobile senza overflow orizzontale', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    const h1 = page.locator('h1').first();
    await expect(h1).toBeVisible({ timeout: 10000 });

    // Verifica nessun overflow orizzontale
    const hasOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasOverflow, 'Overflow orizzontale su mobile').toBe(false);
  });

  test('/?login=true su mobile — form di accesso visibile', async ({ page }) => {
    await page.goto(`${BASE}/?login=true`, { waitUntil: 'networkidle' });
    const accessForm = page.getByText('Login with Google')
      .or(page.getByText(/workspace/i))
      .or(page.getByText(/sfoglia/i))
      .or(page.getByText(/accesso/i));
    await expect(accessForm.first()).toBeVisible({ timeout: 10000 });
  });

  test('/download su mobile — 3 card OS visibili in colonna', async ({ page }) => {
    await page.goto(`${BASE}/download`, { waitUntil: 'networkidle' });
    // Mac, Windows, Linux devono essere visibili (anche in layout stacked)
    const macEl = page.getByText(/mac|macos/i).first();
    const winEl = page.getByText(/windows/i).first();
    const linEl = page.getByText(/linux/i).first();

    await expect(macEl).toBeVisible({ timeout: 10000 });
    await expect(winEl).toBeVisible({ timeout: 10000 });
    await expect(linEl).toBeVisible({ timeout: 10000 });
  });

  test('navbar presente e visibile su mobile', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'networkidle' });

    // Navbar può essere <nav>, <header>, hamburger, o link di navigazione top-level
    const nav = page.locator(
      'nav, [role="navigation"], ' +
      'button[aria-label*="menu" i], button[aria-label*="hamburger" i], ' +
      '[data-testid="hamburger"], .hamburger'
    ).first();
    await expect(nav).toBeVisible({ timeout: 10000 });
  });

});
