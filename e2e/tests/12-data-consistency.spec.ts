import { test, expect } from '@playwright/test';
import { ensureSeededWorkspace, loginToSeededWorkspace } from './_helpers/workspace';

const WORKSPACE = '/tmp/jht-e2e-data-consistency';

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
  test.beforeAll(async ({ request }) => {
    await ensureSeededWorkspace(request, WORKSPACE);
  });

  test.beforeEach(async ({ page }) => {
    await loginToSeededWorkspace(page, WORKSPACE);
  });

  test('/applications mostra 1 candidatura pronta e 1 inviata nel workspace seedato', async ({ page }) => {
    await page.goto('/applications');
    await expect(page.getByText(/2 totali · 1 inviate · 1 pronte/i)).toBeVisible();
    await expect(page.getByText(/pronte all'invio — 1/i)).toBeVisible();
    await expect(page.getByText(/inviate — 1/i)).toBeVisible();
  });

  test('/positions con filtro ready mostra 1 posizione pronta nel workspace seedato', async ({ page }) => {
    await page.goto('/positions?status=ready');
    await expect(page.getByText(/1 risultati · status: ready/i)).toBeVisible();
    const rows = page.locator('table[aria-label="Lista posizioni"] tbody tr');
    await expect(rows).toHaveCount(1);
    await expect(page.getByRole('link', { name: /frontend engineer/i })).toBeVisible();
  });
});
