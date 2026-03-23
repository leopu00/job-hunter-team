import { test, expect } from '@playwright/test';

/**
 * FLUSSO 6 — FLUSSO COMPLETO END-TO-END
 * Il test più importante: simula l'utente che usa la piattaforma da un browser esterno
 * Login → vede job offers → apre una position → trova i PDF → aggiorna stato
 * Dipendenza: TUTTE le fasi precedenti completate
 */

test.describe('Flusso Completo E2E', () => {
  test.skip('flusso completo: homepage → login → dashboard → position detail', async ({ page }) => {
    // SKIP: dipende da TUTTE le fasi
    // Step 1: Homepage accessibile
    await page.goto('/');
    await expect(page).toHaveTitle(/.+/);

    // Step 2: Bottone login visibile
    const loginButton = page.getByRole('link', { name: /login|sign in|accedi/i })
      .or(page.getByRole('button', { name: /google/i }));
    await expect(loginButton).toBeVisible();

    // Step 3 (simulato con storageState): dashboard carica
    // In test reale: await page.goto('/dashboard') con sessione attiva
    // await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();

    // Step 4: click su una position
    // const firstPosition = page.locator('[data-testid="position-row"]').first();
    // await firstPosition.click();
    // await expect(page).toHaveURL(/\/positions\/\d+/);

    // Step 5: pagina position ha link Drive
    // const driveLink = page.locator('a[href*="drive.google.com"]').first();
    // await expect(driveLink).toBeVisible();
  });

  test('piattaforma risponde su URL base (smoke test)', async ({ page }) => {
    // Questo test NON è skippato — verifica che il deploy Vercel sia up
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(500);
    await expect(page).toHaveTitle(/.+/);
  });
});
