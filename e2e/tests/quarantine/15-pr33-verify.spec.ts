import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { ensureSeededWorkspace, loginToSeededWorkspace } from '../_helpers/workspace';

/**
 * VERIFICA /positions — smoke, no-leak, job description.
 *
 * (1) /positions — route risponde + nessun leak di contenuto interno
 * (2) /positions/[id] — job description + link annuncio visibili
 *
 * NB: il filtro TIER (Seria/Practice/Riferimento) e la route /crescita
 * (tier breakdown) di PR #33 sono stati DISMESSI — /positions filtra ora per
 * range numerico di score scelto dall'utente. I relativi test sono stati
 * rimossi: niente più categorizzazione practice/seria, il team dà solo lo score.
 *
 * Le route sono protette: i test verificano struttura, redirect e contenuto.
 */

const REPORT_DIR = path.join(__dirname, '../../../reports/visual');
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
