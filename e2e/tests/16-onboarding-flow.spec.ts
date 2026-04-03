import { test, expect } from '@playwright/test';

/**
 * FLUSSO 16 — ONBOARDING E SETUP WIZARD
 * Verifica il flusso completo di configurazione iniziale via web:
 * pagina /setup carica, i passi del wizard sono navigabili,
 * i provider disponibili sono visibili e selezionabili.
 */

const BASE = process.env.BASE_URL || 'https://job-hunter-team.vercel.app';

test.describe('Onboarding — Setup Wizard Web', () => {

  test('pagina /setup carica correttamente', async ({ page }) => {
    const res = await page.goto(`${BASE}/setup`);
    expect(res?.status()).toBeLessThan(500);
    await expect(page).toHaveTitle(/.+/);
  });

  test('wizard mostra header e label "setup"', async ({ page }) => {
    await page.goto(`${BASE}/setup`);
    await expect(page.getByText('setup', { exact: false })).toBeVisible();
    await expect(page.getByText('Job Hunter', { exact: false })).toBeVisible();
  });

  test('step 1: selezione provider — Claude, OpenAI, MiniMax visibili', async ({ page }) => {
    await page.goto(`${BASE}/setup`);
    await expect(page.getByText('Claude', { exact: false })).toBeVisible();
    await expect(page.getByText('OpenAI', { exact: false })).toBeVisible();
    await expect(page.getByText('MiniMax', { exact: false })).toBeVisible();
  });

  test('selezione Claude — avanza allo step auth', async ({ page }) => {
    await page.goto(`${BASE}/setup`);
    const claudeOption = page.getByText('Anthropic', { exact: false }).first()
      .or(page.getByText('Claude', { exact: false }).first());
    await claudeOption.click();
    const nextBtn = page.getByRole('button', { name: /avanti|next|continua|prosegui/i });
    await nextBtn.click();
    const apiKeyField = page.getByPlaceholder(/sk-ant/i)
      .or(page.getByLabel(/api key/i));
    await expect(apiKeyField).toBeVisible();
  });

  test('content guard: nessun nome agente interno nelle pagine pubbliche', async ({ page }) => {
    await page.goto(`${BASE}/setup`);
    const body = await page.textContent('body') || '';
    const terminiInterni = ['Ace', 'Max', 'Dot', 'Lex', 'Dan', 'Tom', 'worktree', 'tmux'];
    for (const termine of terminiInterni) {
      expect(body).not.toContain(termine);
    }
  });

  test('homepage risponde (smoke test)', async ({ page }) => {
    const res = await page.goto(`${BASE}/`);
    expect(res?.status()).toBeLessThan(500);
    await expect(page).toHaveTitle(/.+/);
  });

});
