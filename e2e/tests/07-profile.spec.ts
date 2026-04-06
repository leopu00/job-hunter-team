import { test, expect } from '@playwright/test';
import { ensureSeededWorkspace, loginToSeededWorkspace } from './_helpers/workspace';

const WORKSPACE = '/tmp/jht-e2e-profile';

/**
 * FLUSSO 7 — PAGINA PROFILO CANDIDATO /profile
 * Verifica: dopo login → /profile mostra dati candidato (non "Nessun profilo")
 * BUG APERTO: BUG-E2E-03 — /profile mostra "Nessun profilo configurato"
 * Causa: candidate_profile.yml non migrato da legacy → Supabase
 * Owner: Max (migrazione) + Dot (visualizzazione)
 * Dipendenza: sessione autenticata + profilo migrato su Supabase
 */

test.describe('Profilo Candidato', () => {
  test.beforeAll(async ({ request }) => {
    await ensureSeededWorkspace(request, WORKSPACE);
  });

  test.beforeEach(async ({ page }) => {
    await loginToSeededWorkspace(page, WORKSPACE);
  });

  test('pagina /profile risponde senza errore 500', async ({ page }) => {
    const response = await page.goto('/profile');
    expect(response?.status()).toBeLessThan(500);
    await expect(page.getByRole('heading', { name: /profilo candidato/i })).toBeVisible();
  });

  test('/profile con sessione mostra dati candidato', async ({ page }) => {
    await page.goto('/profile');
    await expect(page.getByText(/nessun profilo configurato/i)).not.toBeVisible();
    await expect(page.getByRole('heading', { name: /leone test/i })).toBeVisible();
    await expect(page.getByText(/frontend engineer/i).first()).toBeVisible();
    await expect(page.getByText(/leone\.test@example\.com/i).first()).toBeVisible();
  });
});
