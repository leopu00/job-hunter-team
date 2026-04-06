import { test, expect } from '@playwright/test';
import { ensureSeededWorkspace, loginToSeededWorkspace } from './_helpers/workspace';

const WORKSPACE = '/tmp/jht-e2e-dashboard-data';

/**
 * FLUSSO 10 — DASHBOARD CON DATI REALI (post-login)
 * Verifica: dopo login → dashboard mostra dati reali (non 0)
 * BUG ROOT CAUSE: middleware.ts mancante → RLS blocca query → 0 risultati
 * Fix: Dot aggiunge web/middleware.ts per refresh cookie sessione Supabase SSR
 * Dipendenza: fix middleware deployato + storageState autenticato
 */

test.describe('Dashboard — dati reali post-login', () => {
  test.beforeAll(async ({ request }) => {
    await ensureSeededWorkspace(request, WORKSPACE);
  });

  test.beforeEach(async ({ page }) => {
    await loginToSeededWorkspace(page, WORKSPACE);
  });

  test('dashboard non mostra contatori a zero dopo il fix middleware', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
    await expect(page.getByText(/3 posizioni totali/i).first()).toBeVisible();
  });

  test('dashboard autenticata mostra positions', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('table', { name: /posizioni recenti/i })).toBeVisible();
    const rows = page.locator('table[aria-label="Posizioni recenti"] tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('link', { name: /frontend engineer/i })).toBeVisible();
  });
});
