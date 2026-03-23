import { test, expect } from '@playwright/test';

/**
 * TEST CONSISTENZA DATI — Verifica che UI mostri dati coerenti col DB
 * CHIARIMENTO Max (corretto):
 * - "Pronte all'invio" = applications.status='ready' (3) = CV scritto + revisionato → pronte per l'invio ✅ CORRETTO
 * - positions.status='ready' (58) = posizione pronta per SCRITTURA CV (scrittore deve lavorarci)
 * - I due contatori misurano cose diverse — NON è un bug
 * Dipendenza: sessione autenticata
 */

/**
 * NOTA BUG-DATA-02: 33 applications con critic_verdict='PASS' bloccate in 'draft'
 * NON è un bug di migrazione — il legacy non aggiornava lo status dopo approvazione critico.
 * Fix: agente o script che aggiorni status → 'ready' quando critic_verdict='PASS'.
 * Owner: Max (script di pulizia) o nuovo agente workflow.
 */

test.describe('Consistenza dati UI vs DB', () => {
  test.skip('dashboard mostra 3 "pronte all\'invio" (applications.ready — corretto)', async ({ page }) => {
    // SKIP: richiede sessione autenticata
    // VALORE CORRETTO: 3 (applications con CV scritto + revisionato, pronti da inviare)
    // DISTINTO da positions.ready=58 (posizioni dove scrittore deve ancora lavorare)
    await page.goto('/dashboard');
    const readyCount = page.locator('[data-testid="ready-count"], .ready-count, .stat-ready');
    const countText = await readyCount.textContent();
    const count = parseInt(countText || '0');
    expect(count).toBe(3);
  });

  test.skip('/positions con filtro ready mostra 58 posizioni (scrittore backlog)', async ({ page }) => {
    // SKIP: richiede sessione autenticata
    // 58 positions.ready = backlog scrittore, NON CV pronti da inviare
    await page.goto('/positions?status=ready');
    const rows = page.locator('table tbody tr, [data-testid="position-row"], .position-item');
    const count = await rows.count();
    expect(count).toBe(58);
  });
});
