import { test, expect } from '@playwright/test';
import { ensureSeededWorkspace, loginToSeededWorkspace } from './_helpers/workspace';

const WORKSPACE = '/tmp/jht-e2e-applications';

/**
 * FLUSSO 4 — APPLICAZIONI CON LINK GOOGLE DRIVE
 * Verifica: sezione /applications → CV e Cover Letter accessibili via link Drive
 * Dipendenza: Fase 3 Max (PDF su Drive, link in DB), Fase 4 Dot (pagina applications)
 * STATO MAX: 79/172 applications hanno già cv_drive_id + cl_drive_id — formato: drive.google.com/file/d/{id}/view
 */

test.describe('Applicazioni e Google Drive', () => {
  test.beforeAll(async ({ request }) => {
    await ensureSeededWorkspace(request, WORKSPACE);
  });

  test.beforeEach(async ({ page }) => {
    await loginToSeededWorkspace(page, WORKSPACE);
  });

  test('/applications carica lista applicazioni', async ({ page }) => {
    await page.goto('/applications');
    await expect(page.getByRole('heading', { name: /candidature/i })).toBeVisible();
    await expect(page.getByText(/2 totali · 1 inviate · 1 pronte/i)).toBeVisible();
    await expect(page.getByRole('link', { name: /frontend engineer/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /platform engineer/i })).toBeVisible();
  });

  test('link CV Google Drive è accessibile', async ({ page }) => {
    await page.goto('/applications');
    const cvLink = page.getByRole('link', { name: /cv/i }).first();
    await expect(cvLink).toBeVisible();
    const href = await cvLink.getAttribute('href');
    expect(href).toMatch(/drive\.google\.com\/file\/d\/.+\/view/);
  });

  test('link Cover Letter Google Drive è accessibile', async ({ page }) => {
    await page.goto('/applications');
    const clLink = page.getByRole('link', { name: /cover letter/i }).first();
    await expect(clLink).toBeVisible();
    const href = await clLink.getAttribute('href');
    expect(href).toMatch(/drive\.google\.com\/file\/d\/.+\/view/);
  });

  test('application con stato "applied" mostra timestamp invio', async ({ page }) => {
    await page.goto('/applications');
    await expect(page.getByText(/inviata 2026-04-05/i)).toBeVisible();
    await expect(page.getByText(/via linkedin/i)).toBeVisible();
  });
});
