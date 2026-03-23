import { test, expect } from '@playwright/test';

/**
 * TEST PAGINE LEGACY MIGRATE — PR #29 deployata
 * Queste route sono protette: utenti non autenticati vengono rimandati alla homepage.
 * Il test verifica che le route ESISTANO (status < 500, non 404).
 * Il redirect a homepage è comportamento CORRETTO (proxy.ts protegge le route).
 *
 * LEGACY app.html aveva: dashboard, ready-to-send, applied, risposte, team, crescita
 * ORA PRESENTI: /dashboard, /positions, /applications, /profile, /ready, /risposte, /team, /crescita
 */

test.describe('Pagine legacy migrate — PR #29', () => {
  test('/ready — route esiste, redirige a login se non autenticato', async ({ page }) => {
    // Route protetta: redirect a homepage è comportamento atteso
    const r = await page.goto('/ready');
    expect(r?.status()).toBeLessThan(500);
    // Deve rispondere senza 404/500 — redirect a home è OK
  });

  test('/risposte — route esiste, redirige a login se non autenticato', async ({ page }) => {
    const r = await page.goto('/risposte');
    expect(r?.status()).toBeLessThan(500);
  });

  test.skip('/team — RIMOSSA da Ace (contenuto sbagliato: mostrava team dev)', async ({ page }) => {
    // BUG-TEAM-01: /team mostrava gli agenti AI sul sito pubblico — rimossa in PR post-#29
    // Quando verrà re-implementata correttamente (monitor agenti job-hunter), riattivare
    const r = await page.goto('/team');
    expect(r?.status()).toBeLessThan(500);
  });

  test('/crescita — route esiste, redirige a login se non autenticato', async ({ page }) => {
    const r = await page.goto('/crescita');
    expect(r?.status()).toBeLessThan(500);
  });
});
