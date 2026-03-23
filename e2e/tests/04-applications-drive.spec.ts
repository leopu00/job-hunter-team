import { test, expect } from '@playwright/test';

/**
 * FLUSSO 4 — APPLICAZIONI CON LINK GOOGLE DRIVE
 * Verifica: sezione /applications → CV e Cover Letter accessibili via link Drive
 * Dipendenza: Fase 3 Max (PDF su Drive, link in DB), Fase 4 Dot (pagina applications)
 * STATO MAX: 79/172 applications hanno già cv_drive_id + cl_drive_id — formato: drive.google.com/file/d/{id}/view
 */

test.describe('Applicazioni e Google Drive', () => {
  test.skip('/applications carica lista applicazioni', async ({ page }) => {
    // SKIP: dipende da Dot Fase 4 e Max Fase 3
    await page.goto('/applications');
    const appRows = page.locator('[data-testid="application-row"], .application-item');
    await expect(appRows.first()).toBeVisible({ timeout: 10_000 });
  });

  test.skip('link CV Google Drive è accessibile', async ({ page }) => {
    // SKIP: dipende da Dot Fase 4 (pagina /applications)
    // FORMATO URL Drive confermato da Max: https://drive.google.com/file/d/{file_id}/view
    await page.goto('/applications');
    const cvLink = page.locator('[data-testid="cv-link"], a[href*="drive.google.com"]').first();
    await expect(cvLink).toBeVisible();
    const href = await cvLink.getAttribute('href');
    expect(href).toMatch(/drive\.google\.com\/file\/d\/.+\/view/);
  });

  test.skip('link Cover Letter Google Drive è accessibile', async ({ page }) => {
    // SKIP: dipende da Max Fase 3
    await page.goto('/applications');
    const clLink = page.locator('[data-testid="cover-letter-link"], a[href*="drive.google.com"]').first();
    await expect(clLink).toBeVisible();
  });

  test.skip('application con stato "applied" mostra timestamp invio', async ({ page }) => {
    // SKIP: dipende da Sheets sync (Max Fase 5)
    await page.goto('/applications');
    const appliedRow = page.locator('[data-status="applied"]').first();
    await expect(appliedRow.locator('[data-testid="applied-at"], .applied-timestamp')).toBeVisible();
  });
});
