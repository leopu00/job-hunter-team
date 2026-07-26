import { test, expect } from '@playwright/test';

/**
 * FLUSSO 5 — INTEGRAZIONE GOOGLE SHEETS
 * Verifica: la piattaforma legge/mostra dati da Google Sheets
 * e la spunta su Sheets si riflette nel DB / nella dashboard
 * Dipendenza: Fase 5 Max (sync Sheets ↔ Supabase) ✅ COMPLETATA
 * Env var richiesta: GOOGLE_SHEETS_ID (non committare l'ID reale)
 */

const SHEETS_ID = process.env.GOOGLE_SHEETS_ID;

if (!SHEETS_ID) {
  console.warn('GOOGLE_SHEETS_ID non definita — test Sheets verranno saltati');
}

test.describe('Google Sheets Integration', () => {
  test.skip('dashboard mostra link al Google Sheet corretto', async ({ page }) => {
    // SKIP: dipende da sessione autenticata + Dot Fase 4 (link nel frontend)
    if (!SHEETS_ID) test.skip(true, 'GOOGLE_SHEETS_ID non definita');
    await page.goto('/dashboard');
    const sheetsLink = page.locator(`a[href*="${SHEETS_ID}"]`)
      .or(page.locator('a[href*="docs.google.com/spreadsheets"]'));
    await expect(sheetsLink).toBeVisible();
    const href = await sheetsLink.getAttribute('href');
    expect(href).toContain(SHEETS_ID);
  });

  test.skip('stato "applied" su Sheets si riflette nella dashboard', async ({ page }) => {
    // SKIP: questo flusso è asincrono — si testa dopo sync manuale
    // 1. L'utente mette spunta su Sheets → timestamp creato
    // 2. Agente legge Sheets → aggiorna Supabase
    // 3. Dashboard mostra stato aggiornato
    await page.goto('/dashboard');
    // Verifica che almeno una position mostri stato "applied"
    const appliedBadge = page.locator('[data-status="applied"], .status-applied').first();
    await expect(appliedBadge).toBeVisible({ timeout: 15_000 });
  });
});
