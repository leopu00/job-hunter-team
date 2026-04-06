import { test, expect } from '@playwright/test';
import { ensureSeededWorkspace, loginToSeededWorkspace } from './_helpers/workspace';

const WORKSPACE = '/tmp/jht-e2e-dashboard';

/**
 * FLUSSO 2 — DASHBOARD JOB OFFERS
 * Verifica: dopo login → dashboard mostra lista positions con stati
 * Dipendenza: Supabase migrato (Fase 2 Max), frontend dashboard (Fase 4 Dot)
 * DATI ATTESI: ~530 positions, ~255 companies migrate da legacy
 */

test.describe('Dashboard Job Offers', () => {
  test.beforeAll(async ({ request }) => {
    await ensureSeededWorkspace(request, WORKSPACE);
  });

  test.beforeEach(async ({ page }) => {
    await loginToSeededWorkspace(page, WORKSPACE);
  });

  test('dashboard carica lista positions', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
    await expect(page.getByText(/3 posizioni totali/i)).toBeVisible();
    await expect(page.getByRole('table', { name: /posizioni recenti/i })).toBeVisible();
    const positionRows = page.locator('table[aria-label="Posizioni recenti"] tbody tr');
    await expect(positionRows.first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('link', { name: /frontend engineer/i })).toBeVisible();
  });

  test('dashboard mostra filtro per stato pipeline', async ({ page }) => {
    await page.goto('/dashboard');
    for (const status of ['new', 'ready', 'applied']) {
      await expect(page.locator(`a[href="/positions?status=${status}"]`).first()).toBeVisible();
    }
  });

  test('dashboard mostra score per ogni position', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByText('88').first()).toBeVisible();
    await expect(page.getByText('72').first()).toBeVisible();
  });
});
