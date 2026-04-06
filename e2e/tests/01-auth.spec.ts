import { test, expect } from '@playwright/test';

/**
 * FLUSSO 1 — AUTENTICAZIONE GOOGLE
 * Verifica: login con Google OAuth → redirect alla dashboard → sessione attiva
 * NOTA PRIVACY: i test con sessione richiedono un account Google configurato in locale
 * Eseguire solo in locale con storageState, mai in CI pubblica
 */

async function openLoginEntry(page: Parameters<typeof test>[0]['page']) {
  await page.goto('/?login=true');
  await expect(page).toHaveTitle('Job Hunter Team');
}

async function getEntryMode(page: Parameters<typeof test>[0]['page']) {
  const cloudView = page.getByRole('button', { name: 'Login with Google' });
  const localView = page.getByText('Seleziona la tua cartella di lavoro', { exact: false });

  const mode = await Promise.race([
    cloudView.waitFor({ state: 'visible', timeout: 3000 }).then(() => 'cloud' as const),
    localView.waitFor({ state: 'visible', timeout: 3000 }).then(() => 'local' as const),
  ]).catch(() => 'unknown' as const);

  if (mode === 'cloud') return 'cloud';
  if (mode === 'local') return 'local';

  return 'unknown';
}

async function expectProtectedRouteBehavior(
  page: Parameters<typeof test>[0]['page'],
  route: '/dashboard' | '/positions' | '/applications' | '/profile',
) {
  await page.goto(route);
  const pathname = new URL(page.url()).pathname;

  if (pathname === '/') {
    await expect(page).toHaveTitle('Job Hunter Team');
    await expect(page.getByRole('link', { name: /accedi|sign in/i })).toBeVisible();
    return;
  }

  expect(pathname).toBe(route);
  await expect(page).toHaveTitle(/.+/);
}

test.describe('Autenticazione Google', () => {
  test('entrypoint login mostra il titolo e la vista corretta per l\'ambiente', async ({ page }) => {
    await openLoginEntry(page);
    const mode = await getEntryMode(page);

    if (mode === 'cloud') {
      await expect(page.getByText('Login with Google')).toBeVisible();
      await expect(page.getByText('Sistema multi-agente per ricerca e candidatura', { exact: false })).toBeVisible();
      return;
    }

    expect(mode).toBe('local');
    await expect(page.getByText('modalita locale', { exact: false })).toBeVisible();
    await expect(page.getByText('Seleziona la tua cartella di lavoro', { exact: false })).toBeVisible();
  });

  test('entrypoint login mostra copy coerente con cloud o workspace locale', async ({ page }) => {
    await openLoginEntry(page);
    const mode = await getEntryMode(page);

    if (mode === 'cloud') {
      await expect(page.getByText('Accesso riservato ai membri del team', { exact: false })).toBeVisible();
      await expect(page.getByRole('link', { name: /scarica per il tuo computer/i })).toBeVisible();
      return;
    }

    expect(mode).toBe('local');
    await expect(page.getByText('I tuoi dati restano sul tuo computer', { exact: false })).toBeVisible();
    await expect(page.getByText('workspace', { exact: false })).toBeVisible();
  });

  test('redirect a Google OAuth al click Login with Google', async ({ page }) => {
    await openLoginEntry(page);
    test.skip(await getEntryMode(page) !== 'cloud', 'Google OAuth disponibile solo con Supabase configurato');
    await page.getByText('Login with Google').click();
    await expect(page).toHaveURL(/accounts\.google\.com|\/auth/);
  });

  test('/dashboard applica il gate previsto dall\'ambiente corrente', async ({ page }) => {
    await expectProtectedRouteBehavior(page, '/dashboard');
  });

  test('/positions applica il gate previsto dall\'ambiente corrente', async ({ page }) => {
    await expectProtectedRouteBehavior(page, '/positions');
  });

  test('/applications applica il gate previsto dall\'ambiente corrente', async ({ page }) => {
    await expectProtectedRouteBehavior(page, '/applications');
  });

  test('/profile applica il gate previsto dall\'ambiente corrente', async ({ page }) => {
    await expectProtectedRouteBehavior(page, '/profile');
  });

  // TODO: test con sessione autenticata — richiede storageState
  // Per attivare: npx playwright codegen --save-storage=auth-state.json https://jobhunterteam.ai
  // Poi: test.use({ storageState: 'auth-state.json' });
});
