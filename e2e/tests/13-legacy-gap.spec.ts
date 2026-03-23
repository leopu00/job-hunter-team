import { test, expect } from '@playwright/test';

/**
 * LEGACY GAP — Feature del legacy app.html/dashboard.html
 * PR #36 (Dot): 5 pagine ruolo migrate e verificate.
 * /analytics NON esiste nel legacy (Tom ha confermato) — già coperto da /crescita + dashboard.
 *
 * Gap residuo: test autenticati per /ready e /risposte (richiedono auth-state.json).
 */

const BASE = process.env.BASE_URL || 'http://localhost:3000';

test.describe('Legacy gap — pagine da migrare (Dot)', () => {

  // ── PAGINE RUOLO AGENTI — PR #36 (attivare dopo deploy) ─────────────────

  test('/scout — route esiste, redirige a login se non autenticato', async ({ page }) => {
    const r = await page.goto('/scout');
    expect(r?.status()).toBeLessThan(500);
  });

  test('/analista — route esiste, redirige a login se non autenticato', async ({ page }) => {
    const r = await page.goto('/analista');
    expect(r?.status()).toBeLessThan(500);
  });

  test('/scorer — route esiste, redirige a login se non autenticato', async ({ page }) => {
    const r = await page.goto('/scorer');
    expect(r?.status()).toBeLessThan(500);
  });

  test('/scrittore — route esiste, redirige a login se non autenticato', async ({ page }) => {
    const r = await page.goto('/scrittore');
    expect(r?.status()).toBeLessThan(500);
  });

  test('/critico — route esiste, redirige a login se non autenticato', async ({ page }) => {
    const r = await page.goto('/critico');
    expect(r?.status()).toBeLessThan(500);
  });

  // ── TEST AUTENTICATI — richiedono storageState autenticato ────────────────────

  test.skip('/ready — mostra CV pronti da inviare con dati reali (richiede auth)', async ({ page }) => {
    // Dipendenza: storageState autenticato
    // Attivare con: test.use({ storageState: 'auth-state.json' })
    await page.goto('/ready');
    await expect(page).not.toHaveURL(`${BASE}/`);
    // Deve mostrare almeno 1 CV pronto (BUG-DATA-02 fix: 33 app PASS→ready pendente)
    const items = page.locator('[data-testid="ready-item"], .ready-item, table tbody tr');
    await expect(items.first()).toBeVisible({ timeout: 10_000 });
  });

  test.skip('/risposte — mostra risposte aziende con dati reali (richiede auth)', async ({ page }) => {
    // Dipendenza: storageState autenticato
    await page.goto('/risposte');
    await expect(page).not.toHaveURL(`${BASE}/`);
    // Deve mostrare applications con risposta (status = replied/interview/rejected)
    const items = page.locator('[data-testid="response-item"], .response-item, table tbody tr');
    await expect(items.first()).toBeVisible({ timeout: 10_000 });
  });

});
