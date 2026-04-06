import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { ensureSeededWorkspace, loginToSeededWorkspace } from './_helpers/workspace';

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
const WORKSPACE = '/tmp/jht-e2e-pr33';

test.beforeAll(() => {
  if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });
});

test.describe('PR #33 — verifica post-deploy', () => {
  test.beforeAll(async ({ request }) => {
    await ensureSeededWorkspace(request, WORKSPACE);
  });

  test.beforeEach(async ({ page }) => {
    await loginToSeededWorkspace(page, WORKSPACE);
  });

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

  test('/positions — mostra filtro TIER', async ({ page }) => {
    await page.goto('/positions');
    await expect(page.getByText(/seria/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/practice/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/riferimento/i)).toBeVisible({ timeout: 10_000 });

    const tier1Tab = page.getByRole('link', { name: /seria/i });
    await tier1Tab.click();
    await expect(page).toHaveURL(/tier=seria/);
    await expect(page.getByText(/2 risultati · seria/i)).toBeVisible();
    const rows = page.locator('table[aria-label="Lista posizioni"] tbody tr');
    await expect(rows).toHaveCount(2);
    await expect(page.getByRole('link', { name: /frontend engineer/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /platform engineer/i })).toBeVisible();

    await page.screenshot({ path: path.join(REPORT_DIR, 'pr33-positions-tier-auth.png'), fullPage: true });
  });

  test('/crescita — mostra analytics tier breakdown', async ({ page }) => {
    await page.goto('/crescita');
    await expect(page.getByText(/seria|tier1/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/linkedin|careerpages|fonte/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/score medio|punteggio medio/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/crescita & analytics/i)).toBeVisible();
    await expect(page.getByText(/posizioni trovate/i)).toBeVisible();

    await page.screenshot({ path: path.join(REPORT_DIR, 'pr33-crescita-analytics-auth.png'), fullPage: true });
  });

  test('/positions/[id] — mostra job description e link annuncio', async ({ page }) => {
    await page.goto('/positions');

    const firstLink = page.getByRole('link', { name: /frontend engineer/i }).first();
    await expect(firstLink).toBeVisible({ timeout: 10_000 });
    const href = await firstLink.getAttribute('href');
    await Promise.all([
      page.waitForURL(/\/positions\/\d+$/, { timeout: 10_000 }),
      firstLink.click(),
    ]);

    await expect(page.getByText(/job description/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/build a next\.js dashboard for job-search automation/i)).toBeVisible({ timeout: 10_000 });

    const externalLink = page.getByRole('link', { name: /annuncio originale/i });
    await expect(externalLink).toBeVisible({ timeout: 10_000 });
    const linkHref = await externalLink.getAttribute('href');
    expect(linkHref).toBeTruthy();
    expect(linkHref).toMatch(/^https?:\/\//); // deve essere URL assoluto

    await page.screenshot({ path: path.join(REPORT_DIR, 'pr33-position-detail.png'), fullPage: true });
    console.log(`Posizione testata: ${href} — link esterno: ${linkHref}`);
  });

});
