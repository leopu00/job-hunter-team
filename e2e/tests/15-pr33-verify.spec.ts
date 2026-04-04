import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * VERIFICA PR #33 — Filtro TIER, Analytics, Job Description
 * Da eseguire dopo deploy PR #33.
 *
 * (1) /positions — filtro TIER (Seria/Practice/Riferimento/Non scored)
 * (2) /crescita — analytics con tier breakdown + fonti + score medio
 * (3) /positions/[id] — job description visibile
 *
 * Le route sono protette: i test senza auth verificano struttura e redirect.
 * I test con .skip richiedono storageState autenticato.
 */

const REPORT_DIR = path.join(__dirname, '../../reports/visual');

test.beforeAll(() => {
  if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });
});

test.describe('PR #33 — verifica post-deploy', () => {

  // ── SMOKE: route rispondono senza crash ──────────────────────────────────

  test('/positions — route risponde senza 500', async ({ page }) => {
    const r = await page.goto('/positions');
    expect(r?.status()).toBeLessThan(500);
    await page.screenshot({ path: path.join(REPORT_DIR, 'pr33-positions.png'), fullPage: true });
  });

  test('/crescita — route risponde senza 500', async ({ page }) => {
    const r = await page.goto('/crescita');
    expect(r?.status()).toBeLessThan(500);
    await page.screenshot({ path: path.join(REPORT_DIR, 'pr33-crescita.png'), fullPage: true });
  });

  test('/positions non espone contenuto interno dev team', async ({ page }) => {
    await page.goto('/positions');
    const bodyText = await page.locator('body').innerText();
    const bodyLower = bodyText.toLowerCase();
    // Anche dopo redirect, la homepage non deve avere leak interni
    for (const pattern of [/worktree/, /\btmux\b/, /jht-coord/, /\banthropic\b/]) {
      expect(bodyLower, `Contenuto vietato: ${pattern}`).not.toMatch(pattern);
    }
  });

  // ── AUTENTICATI: verifica contenuto reale (richiede storageState autenticato) ──

  test.skip('/positions — mostra filtro TIER (richiede auth)', async ({ page }) => {
    // Attivare con: test.use({ storageState: 'auth-state.json' })
    await page.goto('/positions');
    await expect(page).not.toHaveURL('https://jobhunterteam.ai/');

    // I 4 tier devono essere visibili come tab/filtro
    await expect(page.getByText(/seria/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/practice/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/riferimento/i)).toBeVisible({ timeout: 10_000 });

    // Tier1 deve mostrare ~25 posizioni (Max: Tier1>=70 = 25)
    const tier1Tab = page.getByText(/seria/i);
    await tier1Tab.click();
    const rows = page.locator('table tbody tr, [data-testid="position-row"], .position-item');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(30); // max ~25

    await page.screenshot({ path: path.join(REPORT_DIR, 'pr33-positions-tier-auth.png'), fullPage: true });
  });

  test.skip('/crescita — mostra analytics tier breakdown (richiede auth)', async ({ page }) => {
    // Attivare con: test.use({ storageState: 'auth-state.json' })
    await page.goto('/crescita');
    await expect(page).not.toHaveURL('https://jobhunterteam.ai/');

    // Deve mostrare distribuzione tier
    await expect(page.getByText(/seria|tier1/i)).toBeVisible({ timeout: 10_000 });
    // Deve mostrare distribuzione fonti (LinkedIn, CareerPage, ecc.)
    await expect(page.getByText(/linkedin|careerpages|fonte/i)).toBeVisible({ timeout: 10_000 });
    // Deve mostrare score medio
    await expect(page.getByText(/score medio|punteggio medio/i)).toBeVisible({ timeout: 10_000 });

    await page.screenshot({ path: path.join(REPORT_DIR, 'pr33-crescita-analytics-auth.png'), fullPage: true });
  });

  test.skip('/positions/[id] — mostra job description e link annuncio (richiede auth)', async ({ page }) => {
    // Attivare con: test.use({ storageState: 'auth-state.json' })
    await page.goto('/positions');
    await expect(page).not.toHaveURL('https://jobhunterteam.ai/');

    const firstLink = page.locator('a[href*="/positions/"]').first();
    await expect(firstLink).toBeVisible({ timeout: 10_000 });
    const href = await firstLink.getAttribute('href');
    await firstLink.click();

    await expect(page).not.toHaveURL('https://jobhunterteam.ai/');
    expect(page.url()).toContain('/positions/');

    // Job description visibile
    await expect(page.locator('[data-testid="job-description"], .job-description, article').first())
      .toBeVisible({ timeout: 10_000 });

    // Link "Vedi offerta originale" presente e punta a URL esterno (positions.url nel DB)
    const externalLink = page.getByText(/vedi offerta originale/i);
    await expect(externalLink).toBeVisible({ timeout: 10_000 });
    const linkHref = await externalLink.locator('..').getAttribute('href')
      ?? await externalLink.getAttribute('href');
    expect(linkHref).toBeTruthy();
    expect(linkHref).toMatch(/^https?:\/\//); // deve essere URL assoluto

    await page.screenshot({ path: path.join(REPORT_DIR, 'pr33-position-detail.png'), fullPage: true });
    console.log(`Posizione testata: ${href} — link esterno: ${linkHref}`);
  });

});
