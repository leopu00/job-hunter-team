import { test, expect } from '@playwright/test';

/**
 * CONTENT GUARD — Verifica che le pagine pubbliche non espongano contenuti sbagliati
 * Questo test avrebbe bloccato il bug /team (agenti dev esposti sul sito pubblico).
 *
 * REGOLA: ogni nuova pagina frontend deve passare questo check PRIMA del merge PR.
 * Copre sia contenuto atteso (deve esserci) sia contenuto vietato (non deve esserci).
 */

// Pattern che NON devono mai apparire sul sito pubblico (contenuto interno dev team)
// Usa \b per word boundary — evita falsi positivi su sottostringhe (es. "tom" in "automatizzata")
const FORBIDDEN_ON_PUBLIC: RegExp[] = [
  /\bace\b/,       // agente dev (non "surface" o "interface")
  /\bmax\b/,       // agente dev
  /\bdot\b/,       // agente dev (non "punto")
  /\blex\b/,       // agente dev
  /\bdan\b/,       // agente dev (non "danza" o "dan" in altri contesti)
  /\btom\b/,       // agente dev (non "auto**m**atizzata")
  /worktree/,      // gergo git interno
  /\btmux\b/,      // strumento dev
  /pull request/,  // gergo dev
  /\bPR #/,        // gergo dev
  /\banthropic\b/, // riferimento AI interno
  /\bllm\b/,       // riferimento AI interno
  /jht-coord/,     // sessione tmux
  /jht-e2e/,       // sessione tmux
  /jht-qa/,        // sessione tmux
];

test.describe('Content guard — pagine pubbliche', () => {

  test('homepage non espone contenuto interno dev team', async ({ page }) => {
    await page.goto('/');
    const bodyText = await page.locator('body').innerText();
    const bodyLower = bodyText.toLowerCase();

    for (const pattern of FORBIDDEN_ON_PUBLIC) {
      expect(
        bodyLower,
        `Homepage contiene testo vietato: ${pattern}`
      ).not.toMatch(pattern);
    }
  });

  test('homepage mostra contenuto pertinente al job hunting', async ({ page }) => {
    await page.goto('/');
    // Deve parlare di ricerca lavoro, non di sviluppo software
    await expect(page.getByText(/job|lavoro|candidatura|posizione|career/i).first()).toBeVisible();
    await expect(page.getByText('Login with Google')).toBeVisible();
  });

  test('/auth/callback non espone contenuto interno dev team', async ({ page }) => {
    await page.goto('/auth/callback');
    const bodyText = await page.locator('body').innerText();
    const bodyLower = bodyText.toLowerCase();

    for (const pattern of [/worktree/, /\btmux\b/, /jht-coord/, /\banthropic\b/]) {
      expect(
        bodyLower,
        `/auth/callback contiene testo vietato: ${pattern}`
      ).not.toMatch(pattern);
    }
  });

  /**
   * CHECKLIST DA ESEGUIRE MANUALMENTE PRIMA DI OGNI MERGE PR FRONTEND:
   *
   * 1. Dan esegue: BASE_URL=https://jobhunterteam.ai npx playwright test 14-content-guard.spec.ts
   * 2. Dan esegue screenshot della nuova pagina
   * 3. Dan verifica manualmente il contenuto rispetto al legacy
   * 4. Tom esegue smoke HTTP (status code)
   *
   * Solo se entrambi passano → Ace può fare merge.
   */
  test.skip('nuova pagina — template content check (usare per ogni PR)', async ({ page }) => {
    // Template: copiare questo test per ogni nuova pagina da validare
    const ROUTE = '/nuova-pagina';
    await page.goto(ROUTE);

    // 1. Nessun contenuto interno dev team
    const bodyText = await page.locator('body').innerText();
    for (const pattern of FORBIDDEN_ON_PUBLIC) {
      expect(bodyText.toLowerCase()).not.toMatch(pattern);
    }

    // 2. Contenuto pertinente al job hunting (personalizzare per la pagina)
    await expect(page.locator('h1, h2')).toBeVisible();

    // 3. Screenshot per verifica visiva
    // await page.screenshot({ path: 'reports/visual/nuova-pagina.png', fullPage: true });
  });

});
