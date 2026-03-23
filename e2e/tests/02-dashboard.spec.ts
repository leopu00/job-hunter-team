import { test, expect } from '@playwright/test';

/**
 * FLUSSO 2 — DASHBOARD JOB OFFERS
 * Verifica: dopo login → dashboard mostra lista positions con stati
 * Dipendenza: Supabase migrato (Fase 2 Max), frontend dashboard (Fase 4 Dot)
 * DATI ATTESI: ~530 positions, ~255 companies migrate da legacy
 */

// TODO: sostituire con storageState autenticato quando disponibile
// test.use({ storageState: 'auth-state.json' });

test.describe('Dashboard Job Offers', () => {
  test.skip('dashboard carica lista positions', async ({ page }) => {
    // SKIP: dipende da autenticazione e Supabase migrato
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: /dashboard|positions|job/i })).toBeVisible();
    // Lista posizioni visibile
    const positionRows = page.locator('[data-testid="position-row"], table tbody tr, .position-item');
    await expect(positionRows.first()).toBeVisible({ timeout: 10_000 });
  });

  test.skip('dashboard mostra filtro per stato pipeline', async ({ page }) => {
    // SKIP: dipende da frontend Dot (Fase 4)
    await page.goto('/dashboard');
    // Filtri: new, checked, scored, writing, review, ready, applied, response
    const statusFilter = page.getByRole('combobox', { name: /stato|status/i })
      .or(page.locator('[data-testid="status-filter"]'));
    await expect(statusFilter).toBeVisible();
  });

  test.skip('dashboard mostra score per ogni position', async ({ page }) => {
    // SKIP: dipende da migrazione scores (Max Fase 2)
    await page.goto('/dashboard');
    const scoreCell = page.locator('[data-testid="score"], .score-badge').first();
    await expect(scoreCell).toBeVisible();
  });
});
