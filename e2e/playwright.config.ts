import { defineConfig, devices } from '@playwright/test';

// In locale usiamo IPv4 esplicito per evitare che `localhost` risolva su ::1
// mentre `next start` ascolta solo su 127.0.0.1.
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: 1,
  reporter: [['html', { outputFolder: 'reports/playwright' }], ['list']],
  use: {
    baseURL: BASE_URL,
    browserName: 'chromium',
    headless: true,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // PRIVACY: non salvare screenshot automatici con dati personali
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
