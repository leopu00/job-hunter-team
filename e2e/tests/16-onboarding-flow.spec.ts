import { test, expect } from '@playwright/test';

/**
 * FLUSSO 16 — ONBOARDING E SETUP WIZARD
 * Verifica il flusso completo di configurazione iniziale via web:
 * pagina /setup carica, i passi del wizard sono navigabili,
 * i provider disponibili sono visibili e selezionabili.
 */

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';

async function openSetup(page: Parameters<typeof test>[0]['page']) {
  const res = await page.goto(`${BASE}/setup`);
  expect(res?.status()).not.toBe(404);
  expect(res?.status()).toBeLessThan(500);
  await expect(page).toHaveTitle(/.+/);
}

async function goToModelStep(page: Parameters<typeof test>[0]['page']) {
  await openSetup(page);
  const nextBtn = page.getByRole('button', { name: /continua/i });
  await expect(nextBtn).toBeEnabled();
  await nextBtn.click();
  await expect(page.getByLabel('Provider AI')).toBeVisible();
}

test.describe('Onboarding — Setup Wizard Web', () => {

  test('pagina /setup carica correttamente (non 404)', async ({ page }) => {
    await openSetup(page);
  });

  test('wizard mostra header e label "setup"', async ({ page }) => {
    await openSetup(page);
    await expect(page.getByText('setup', { exact: false })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Job Hunter Team/i })).toBeVisible();
  });

  test('step modello: provider Claude, OpenAI e MiniMax visibili', async ({ page }) => {
    await goToModelStep(page);
    const provider = page.getByLabel('Provider AI');
    await expect(provider.locator('option')).toHaveCount(3);
    await expect(provider.locator('option').nth(0)).toHaveText(/Anthropic Claude/i);
    await expect(provider.locator('option').nth(1)).toHaveText(/OpenAI/i);
    await expect(provider.locator('option').nth(2)).toHaveText(/MiniMax/i);
  });

  test('selezione Claude — avanza allo step auth', async ({ page }) => {
    await goToModelStep(page);
    await page.getByLabel('Provider AI').selectOption('claude');
    const nextBtn = page.getByRole('button', { name: /continua/i });
    await nextBtn.click();
    const apiKeyField = page.locator('#setup-apikey');
    await expect(apiKeyField).toBeVisible();
    await expect(apiKeyField).toHaveAttribute('placeholder', /sk-/i);
  });

  test('content guard: nessun nome agente interno nelle pagine pubbliche', async ({ page }) => {
    await openSetup(page);
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
