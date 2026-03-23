import { test, expect } from '@playwright/test';

/**
 * FLUSSO 7 — PAGINA PROFILO CANDIDATO /profile
 * Verifica: dopo login → /profile mostra dati candidato (non "Nessun profilo")
 * BUG APERTO: BUG-E2E-03 — /profile mostra "Nessun profilo configurato"
 * Causa: candidate_profile.yml non migrato da legacy → Supabase
 * Owner: Max (migrazione) + Dot (visualizzazione)
 * Dipendenza: sessione autenticata + profilo migrato su Supabase
 */

test.describe('Profilo Candidato', () => {
  test('pagina /profile risponde senza errore 500', async ({ page }) => {
    // Test senza auth — verifica che la pagina esista e non dia errori server
    const response = await page.goto('/profile');
    expect(response?.status()).toBeLessThan(500);
  });

  test.skip('/profile con sessione mostra dati candidato', async ({ page }) => {
    // SKIP: dipende da sessione autenticata + migrazione profilo (Max)
    // BUG-E2E-03: attualmente mostra "Nessun profilo configurato"
    await page.goto('/profile');
    // Non deve mostrare il messaggio di errore
    await expect(page.getByText(/nessun profilo configurato/i)).not.toBeVisible();
    // Deve mostrare almeno nome o email del candidato
    await expect(page.locator('[data-testid="candidate-name"], .candidate-name, h1, h2').first())
      .toBeVisible({ timeout: 5_000 });
  });
});
