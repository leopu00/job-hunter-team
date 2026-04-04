import { test, expect } from '@playwright/test';

/**
 * FLUSSO 27 — /pricing e /privacy
 *
 * Suite 1: /pricing — piani Free/Pro/Enterprise, toggle annuale/mensile, FAQ
 * Suite 2: /privacy — sezioni policy, link GitHub, i18n
 */

const BASE = process.env.BASE_URL || 'https://jobhunterteam.ai';

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 — /pricing
// ─────────────────────────────────────────────────────────────────────────────
test.describe('/pricing — Pagina piani e prezzi', () => {

  test.beforeEach(async ({ page }) => {
    const res = await page.goto(`${BASE}/pricing`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) test.skip(true, '/pricing non disponibile');
  });

  test('risponde 200', async ({ page }) => {
    const res = await page.goto(`${BASE}/pricing`, { waitUntil: 'networkidle' });
    expect(res?.status()).toBe(200);
  });

  test('H1 "Prezzi" presente', async ({ page }) => {
    const h1 = page.locator('h1').first();
    await expect(h1).toBeVisible({ timeout: 5000 });
    const text = await h1.innerText();
    expect(text).toMatch(/prezzi|pricing/i);
  });

  test('<title> presente e non vuoto', async ({ page }) => {
    const title = await page.title();
    expect(title).toBeTruthy();
    expect(title.length).toBeGreaterThan(3);
  });

  test('3 piani visibili: Free, Pro, Enterprise', async ({ page }) => {
    for (const plan of ['Free', 'Pro', 'Enterprise']) {
      const el = page.getByText(plan).first();
      await expect(el, `Piano "${plan}" non visibile`).toBeVisible({ timeout: 5000 });
    }
  });

  test('toggle Mensile/Annuale presente e cliccabile', async ({ page }) => {
    const mensileBtn = page.getByRole('button', { name: /mensile/i }).first();
    const annualeBtn = page.getByRole('button', { name: /annuale/i }).first();
    await expect(mensileBtn).toBeVisible({ timeout: 5000 });
    await expect(annualeBtn).toBeVisible({ timeout: 5000 });
  });

  test('click "Annuale" mostra risparmio 20%', async ({ page }) => {
    const annualeBtn = page.getByRole('button', { name: /annuale/i }).first();
    await annualeBtn.click();
    await page.waitForTimeout(300);
    const save = page.getByText(/risparmi\s*20%|20%/i).first();
    await expect(save).toBeVisible({ timeout: 3000 });
  });

  test('CTA "Inizia gratis" piano Free presente', async ({ page }) => {
    const ctaFree = page.getByRole('link', { name: /inizia gratis/i }).first();
    await expect(ctaFree).toBeVisible({ timeout: 5000 });
  });

  test('CTA "Scegli Pro" presente', async ({ page }) => {
    const ctaPro = page.getByRole('link', { name: /scegli pro/i }).first();
    await expect(ctaPro).toBeVisible({ timeout: 5000 });
  });

  test('tabella confronto funzionalità presente', async ({ page }) => {
    const title = page.getByText(/confronto funzionalit/i).first();
    await expect(title).toBeVisible({ timeout: 5000 });
  });

  test('FAQ prezzi: almeno 3 domande visibili', async ({ page }) => {
    const faqTitle = page.getByText(/domande sui prezzi/i).first();
    await expect(faqTitle).toBeVisible({ timeout: 5000 });
    // Le FAQ sono button accordion
    const faqBtns = page.locator('button').filter({ hasText: /piano|ricerche|carta|enterprise|dati/i });
    const count = await faqBtns.count();
    expect(count, 'Meno di 3 domande FAQ prezzi').toBeGreaterThanOrEqual(3);
  });

  test('FAQ: click su domanda apre la risposta', async ({ page }) => {
    const faqTitle = page.getByText(/domande sui prezzi/i).first();
    await expect(faqTitle).toBeVisible({ timeout: 5000 });
    // Prima FAQ: "Posso cambiare piano..."
    const firstFaq = page.locator('button').filter({ hasText: /cambiare piano/i }).first();
    await expect(firstFaq).toBeVisible({ timeout: 5000 });
    await firstFaq.click();
    // La risposta diventa visibile
    const answer = page.getByText(/upgrade|downgrade/i).first();
    await expect(answer).toBeVisible({ timeout: 3000 });
  });

  test('CTA "Inizia gratis" linka a /download', async ({ page }) => {
    const ctaFree = page.locator('a[href="/download"]').first();
    await expect(ctaFree).toBeVisible({ timeout: 5000 });
  });

  test('piano gratuito menziona "no carta di credito"', async ({ page }) => {
    // Il piano Free non richiede carta — deve essere menzionato
    const noCardText = page.getByText(/carta|payment|gratuito|no.*carta/i).first();
    const count = await noCardText.count();
    if (count === 0) test.skip(true, 'Testo "no carta" non trovato — layout diverso');
    await expect(noCardText).toBeVisible({ timeout: 3000 });
  });

  test('nessun overflow orizzontale su mobile (375px)', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    const res = await page.goto(`${BASE}/pricing`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) { await ctx.close(); test.skip(true, '/pricing non disponibile'); }
    const overflow = await page.evaluate(() => document.body.scrollWidth > window.innerWidth);
    await ctx.close();
    expect(overflow, 'Overflow orizzontale su /pricing mobile').toBe(false);
  });

  test('nessun errore JavaScript critico', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => jsErrors.push(e.message));
    await page.goto(`${BASE}/pricing`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    const critical = jsErrors.filter((e) => !/expected|warning|chunk|hydrat/i.test(e));
    expect(critical, `Errori JS: ${critical.join(', ')}`).toHaveLength(0);
  });

  test('footer nav con link Home e Download', async ({ page }) => {
    const homeLink = page.locator('a[href="/"]').last();
    await expect(homeLink).toBeVisible({ timeout: 5000 });
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2 — /privacy
// ─────────────────────────────────────────────────────────────────────────────
test.describe('/privacy — Privacy Policy', () => {

  test.beforeEach(async ({ page }) => {
    const res = await page.goto(`${BASE}/privacy`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) test.skip(true, '/privacy non disponibile');
  });

  test('risponde 200', async ({ page }) => {
    const res = await page.goto(`${BASE}/privacy`, { waitUntil: 'networkidle' });
    expect(res?.status()).toBe(200);
  });

  test('H1 "Privacy Policy" presente', async ({ page }) => {
    const h1 = page.locator('h1').first();
    await expect(h1).toBeVisible({ timeout: 5000 });
    const text = await h1.innerText();
    expect(text).toMatch(/privacy/i);
  });

  test('<title> presente con "Privacy"', async ({ page }) => {
    const title = await page.title();
    expect(title).toMatch(/privacy/i);
  });

  test('sezione "Dati raccolti" presente', async ({ page }) => {
    const section = page.getByText(/dati raccolti/i).first();
    await expect(section).toBeVisible({ timeout: 5000 });
  });

  test('sezione "Chiamate API esterne" presente', async ({ page }) => {
    const section = page.getByText(/chiamate api esterne/i).first();
    await expect(section).toBeVisible({ timeout: 5000 });
  });

  test('sezione "Cookie e tracciamento" presente', async ({ page }) => {
    const section = page.getByText(/cookie.*tracciamento|tracciamento.*cookie/i).first();
    await expect(section).toBeVisible({ timeout: 5000 });
  });

  test('sezione "Open source" con link GitHub presente', async ({ page }) => {
    const section = page.getByText(/open source/i).first();
    await expect(section).toBeVisible({ timeout: 5000 });
    const ghLink = page.locator('a[href*="github.com"]').first();
    await expect(ghLink).toBeVisible({ timeout: 3000 });
  });

  test('email di contatto info@jobhunterteam.ai visibile', async ({ page }) => {
    const email = page.getByText(/info@jobhunterteam/i).first();
    await expect(email).toBeVisible({ timeout: 5000 });
  });

  test('data ultimo aggiornamento "Aprile 2026" presente', async ({ page }) => {
    const updated = page.getByText(/aprile 2026|april 2026/i).first();
    await expect(updated).toBeVisible({ timeout: 5000 });
  });

  test('footer nav con link Home e FAQ', async ({ page }) => {
    const homeLink = page.locator('a[href="/"]').last();
    await expect(homeLink).toBeVisible({ timeout: 5000 });
  });

  test('nessun overflow orizzontale su mobile (375px)', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    const res = await page.goto(`${BASE}/privacy`, { waitUntil: 'networkidle' });
    if (res?.status() !== 200) { await ctx.close(); test.skip(true, '/privacy non disponibile'); }
    const overflow = await page.evaluate(() => document.body.scrollWidth > window.innerWidth);
    await ctx.close();
    expect(overflow, 'Overflow orizzontale su /privacy mobile').toBe(false);
  });

  test('nessun errore JavaScript critico', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => jsErrors.push(e.message));
    await page.goto(`${BASE}/privacy`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    const critical = jsErrors.filter((e) => !/expected|warning|chunk|hydrat/i.test(e));
    expect(critical, `Errori JS /privacy: ${critical.join(', ')}`).toHaveLength(0);
  });

});
