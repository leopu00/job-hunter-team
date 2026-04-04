import { test, expect } from '@playwright/test';

/**
 * FLUSSO 1 — AUTENTICAZIONE GOOGLE
 * Verifica: login con Google OAuth → redirect alla dashboard → sessione attiva
 * NOTA PRIVACY: i test con sessione richiedono un account Google configurato in locale
 * Eseguire solo in locale con storageState, mai in CI pubblica
 */

test.describe('Autenticazione Google', () => {
  test('homepage mostra titolo e bottone Login with Google', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('Job Hunter Team');
    // Il bottone login non è un <a> ma un elemento cliccabile con questo testo
    await expect(page.getByText('Login with Google')).toBeVisible();
    await expect(page.getByText('Sistema multi-agente per ricerca e candidatura')).toBeVisible();
  });

  test('homepage mostra sezione auth con descrizione OAuth', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('OAuth 2.0 via Supabase')).toBeVisible();
    await expect(page.getByText('Nessuna password memorizzata')).toBeVisible();
  });

  test('redirect a Google OAuth al click Login with Google', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Login with Google').click();
    await expect(page).toHaveURL(/accounts\.google\.com|\/auth/);
  });

  test('/dashboard senza sessione redirige alla homepage', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL('https://jobhunterteam.ai/');
    await expect(page.getByText('Login with Google')).toBeVisible();
  });

  test('/positions senza sessione redirige alla homepage', async ({ page }) => {
    await page.goto('/positions');
    await expect(page).toHaveURL('https://jobhunterteam.ai/');
  });

  test('/applications senza sessione redirige alla homepage', async ({ page }) => {
    await page.goto('/applications');
    await expect(page).toHaveURL('https://jobhunterteam.ai/');
  });

  test('/profile senza sessione redirige alla homepage', async ({ page }) => {
    await page.goto('/profile');
    await expect(page).toHaveURL('https://jobhunterteam.ai/');
  });

  // TODO: test con sessione autenticata — richiede storageState
  // Per attivare: npx playwright codegen --save-storage=auth-state.json https://jobhunterteam.ai
  // Poi: test.use({ storageState: 'auth-state.json' });
});
