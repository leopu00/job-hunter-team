import { test, expect } from '@playwright/test';

/**
 * SMOKE TEST — Google Sheets accessibile pubblicamente
 * Verifica che il foglio sia raggiungibile via browser (link diretto)
 * Non richiede autenticazione alla piattaforma
 */

const SHEETS_ID = process.env.GOOGLE_SHEETS_ID;

test.describe('Google Sheets — accesso diretto', () => {
  test('foglio Google Sheets è raggiungibile via link diretto', async ({ page }) => {
    if (!SHEETS_ID) {
      test.skip(true, 'GOOGLE_SHEETS_ID non definita');
      return;
    }
    const sheetsUrl = `https://docs.google.com/spreadsheets/d/${SHEETS_ID}`;
    const response = await page.goto(sheetsUrl);
    // Il foglio deve rispondere (200 o redirect a login Google, mai 404)
    expect(response?.status()).not.toBe(404);
    expect(response?.status()).toBeLessThan(500);
  });
});
