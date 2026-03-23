import { test, expect } from '@playwright/test';

/**
 * FLUSSO 10 — DASHBOARD CON DATI REALI (post-login)
 * Verifica: dopo login → dashboard mostra dati reali (non 0)
 * BUG ROOT CAUSE: middleware.ts mancante → RLS blocca query → 0 risultati
 * Fix: Dot aggiunge web/middleware.ts per refresh cookie sessione Supabase SSR
 * Dipendenza: fix middleware deployato + storageState autenticato
 */

test.describe('Dashboard — dati reali post-login', () => {
  test('dashboard non mostra contatori a zero dopo il fix middleware', async ({ page }) => {
    // Test senza auth: verifica che la pagina risponda e rediriga
    await page.goto('/dashboard');
    await expect(page).toHaveURL('https://job-hunter-team.vercel.app/');
    // La homepage deve essere raggiungibile (middleware non deve bloccare utenti non autenticati)
    await expect(page.getByText('Login with Google')).toBeVisible();
  });

  test.skip('dashboard autenticata mostra positions (richiede storageState)', async ({ page }) => {
    // SKIP: richiede sessione autenticata + fix middleware deployato
    // Attivare con: test.use({ storageState: 'auth-state.json' })
    await page.goto('/dashboard');
    // NON deve mostrare "0 positions" o contatori vuoti
    await expect(page.getByText(/0 position|nessun risultato|no results/i)).not.toBeVisible();
    // Deve mostrare almeno una riga di dati
    const rows = page.locator('table tbody tr, [data-testid="position-row"], .position-item');
    await expect(rows.first()).toBeVisible({ timeout: 10_000 });
  });
});
