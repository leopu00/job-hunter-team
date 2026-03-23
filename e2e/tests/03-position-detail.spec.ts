import { test, expect } from '@playwright/test';

/**
 * FLUSSO 3 — PAGINA DINAMICA JOB OFFER /positions/[id]
 * Verifica: click su position → pagina generata da record Supabase con dati completi
 * Dipendenza: Fase 4 Dot (/positions/[id] dinamica), Fase 2 Max (dati migrati)
 */

test.describe('Pagina Dinamica Job Offer', () => {
  test.skip('pagina /positions/[id] carica dati company e position', async ({ page }) => {
    // SKIP: dipende da Dot Fase 4
    // Usa un ID noto dopo migrazione — placeholder
    await page.goto('/positions/1');
    await expect(page.getByRole('heading')).toBeVisible();
    // Deve mostrare almeno: nome azienda, titolo posizione, score
    await expect(page.locator('[data-testid="company-name"], .company-name')).toBeVisible();
    await expect(page.locator('[data-testid="position-title"], .position-title')).toBeVisible();
  });

  test.skip('pagina position mostra score e highlights', async ({ page }) => {
    // SKIP: dipende da migrazione scores e highlights (Max Fase 2)
    await page.goto('/positions/1');
    await expect(page.locator('[data-testid="score"], .score')).toBeVisible();
    await expect(page.locator('[data-testid="highlights"], .highlights')).toBeVisible();
  });

  test.skip('URL /positions/[id-inesistente] restituisce 404', async ({ page }) => {
    const response = await page.goto('/positions/999999');
    expect(response?.status()).toBe(404);
  });
});
