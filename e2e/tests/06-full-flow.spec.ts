import { test, expect } from '@playwright/test';
import { ensureSeededWorkspace, loginToSeededWorkspace } from './_helpers/workspace';

const WORKSPACE = '/tmp/jht-e2e-full-flow';

/**
 * FLUSSO 6 — FLUSSO COMPLETO END-TO-END
 * Il test più importante: simula l'utente che usa la piattaforma da un browser esterno
 * Login → vede job offers → apre una position → trova i PDF → aggiorna stato
 * Dipendenza: TUTTE le fasi precedenti completate
 */

test.describe('Flusso Completo E2E', () => {
  test.beforeAll(async ({ request }) => {
    await ensureSeededWorkspace(request, WORKSPACE);
  });

  test('flusso completo: homepage → login → dashboard → position detail', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/.+/);

    const loginButton = page.getByRole('link', { name: /login|sign in|accedi/i });
    await expect(loginButton).toBeVisible();

    await loginToSeededWorkspace(page, WORKSPACE);
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
    const firstPosition = page.getByRole('link', { name: /frontend engineer/i }).first();
    await expect(firstPosition).toBeVisible();
    await firstPosition.click();

    await expect(page).toHaveURL(/\/positions\/1$/);
    await expect(page.getByRole('heading', { name: /frontend engineer/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /annuncio originale/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /cv \(drive\)/i })).toBeVisible();
  });

  test('piattaforma risponde su URL base (smoke test)', async ({ page }) => {
    // Questo test NON è skippato — verifica che il deploy Vercel sia up
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(500);
    await expect(page).toHaveTitle(/.+/);
  });
});
