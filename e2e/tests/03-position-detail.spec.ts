import { test, expect } from '@playwright/test';
import { ensureSeededWorkspace, loginToSeededWorkspace } from './_helpers/workspace';

const WORKSPACE = '/tmp/jht-e2e-position-detail';

/**
 * FLUSSO 3 — PAGINA DINAMICA JOB OFFER /positions/[id]
 * Verifica: click su position → pagina generata da record Supabase con dati completi
 * Dipendenza: Fase 4 Dot (/positions/[id] dinamica), Fase 2 Max (dati migrati)
 */

test.describe('Pagina Dinamica Job Offer', () => {
  test.beforeAll(async ({ request }) => {
    await ensureSeededWorkspace(request, WORKSPACE);
  });

  test.beforeEach(async ({ page }) => {
    await loginToSeededWorkspace(page, WORKSPACE);
  });

  test('pagina /positions/[id] carica dati company e position', async ({ page }) => {
    await page.goto('/positions/1');
    await expect(page.getByRole('heading', { name: /frontend engineer/i })).toBeVisible();
    await expect(page.getByText(/acme remote labs/i)).toBeVisible();
    await expect(page.getByText(/remote \/ italy/i)).toBeVisible();
  });

  test('pagina position mostra score e highlights', async ({ page }) => {
    await page.goto('/positions/1');
    await expect(page.getByText('88').first()).toBeVisible();
    await expect(page.getByText(/score breakdown/i)).toBeVisible();
    await expect(page.getByText(/remote-first team with strong typescript stack/i)).toBeVisible();
    await expect(page.getByText(/fast-paced roadmap with tight weekly releases/i)).toBeVisible();
  });

  test('URL /positions/[id-inesistente] mostra la pagina 404', async ({ page }) => {
    await page.goto('/positions/999999');
    await expect(page.getByRole('heading', { name: '404' })).toBeVisible();
    await expect(page.getByText(/pagina non trovata/i)).toBeVisible();
    await expect(page.getByText('/positions/999999')).toBeVisible();
  });
});
