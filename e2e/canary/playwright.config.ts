import { defineConfig, devices } from "@playwright/test";

// Canarino di produzione, in sola lettura. Sta FUORI da `e2e/tests/` apposta:
// il playwright.config principale raccoglie solo `./tests`, quindi il job
// `e2e` e ogni run locale non lo vedono mai. Lo lancia soltanto il job
// `smoke` di .github/workflows/test.yml (cron o dispatch con `smoke: true`):
//
//   npx playwright test -c canary/playwright.config.ts
//
// Nessuno storage state: la sessione la apre e la chiude la spec stessa.
const isPublicCi = process.env.CI === "true";

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts$/,
  grep: /@prod-canary/,
  timeout: 60_000,
  // Un solo tentativo: un retry farebbe un secondo login in produzione.
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.BASE_URL || "https://jobhunterteam.ai",
    browserName: "chromium",
    headless: true,
    // L'area riservata mostra i dati dell'account di test: nessuna immagine,
    // nessun trace, nessun video in CI (repo pubblico).
    screenshot: "off",
    video: "off",
    trace: isPublicCi ? "off" : "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
