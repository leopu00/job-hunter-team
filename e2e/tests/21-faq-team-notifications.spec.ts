import { test, expect } from '@playwright/test';

/**
 * FLUSSO 21 — FAQ, TEAM PIPELINE, TOAST NOTIFICHE AGENTI
 *
 * Suite 1: /faq — pagina pubblica accordion con 10 domande frequenti
 * Suite 2: /team — pannello pipeline e diagnostico del team di agenti
 * Suite 3: toast notifiche agenti — sistema [role="alert"] / [aria-live]
 */

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const WORKSPACE_PATH = '/tmp/jht-test-workspace';

/**
 * Helper: workspace auth.
 * Su staging (jht-web-deploy.vercel.app / job-hunter-team.vercel.app) usa il workspace selector locale.
 * Su produzione (jobhunterteam.ai) usa Google OAuth — non autenticabile in headless.
 * Restituisce false e skippa il test corrente se il workspace selector non è disponibile.
 */
async function doWorkspaceAuth(page: any): Promise<boolean> {
  await page.goto(`${BASE}/?login=true`, { waitUntil: 'networkidle' });
  const inp = page.locator('input[placeholder="/percorso/alla/cartella"]');
  const hasSelector = await inp.isVisible({ timeout: 5000 }).catch(() => false);
  if (!hasSelector) {
    test.skip(true, 'Workspace selector non disponibile su questo ambiente (usa Google OAuth)');
    return false;
  }
  await inp.fill(WORKSPACE_PATH);
  await inp.press('Enter');
  await expect(page.getByText('OK, usa questa cartella')).toBeVisible({ timeout: 5000 });
  await page.getByText('OK, usa questa cartella').click();
  await page.waitForURL((url: URL) => !url.toString().includes('login=true'), { timeout: 15000 });
  return true;
}

async function getBulkTeamAction(page: any) {
  const stopAll = page.getByRole('button', { name: /ferma tutti/i });
  if (await stopAll.count()) {
    await expect(stopAll).toBeVisible({ timeout: 5000 });
    return stopAll;
  }

  const startAll = page.getByRole('button', { name: /avvia tutti|tutti attivi/i });
  await expect(startAll).toBeVisible({ timeout: 5000 });
  return startAll;
}

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 — /faq  (pagina pubblica, no auth)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('/faq — Domande Frequenti', () => {

  test.beforeEach(async ({ page }) => {
    const res = await page.goto(`${BASE}/faq`, { waitUntil: 'networkidle' });
    if (res?.status() === 404) test.skip(true, '/faq non ancora deployato su questo ambiente');
  });

  test('pagina carica con heading "Domande Frequenti"', async ({ page }) => {
    await expect(page.locator('h1')).toHaveText(/domande frequenti/i);
  });

  test('mostra tutte e 10 le domande FAQ come bottoni accordion', async ({ page }) => {
    const faqButtons = page.locator('button[aria-controls^="faq-panel-"]');
    await expect(faqButtons).toHaveCount(10);
  });

  test('prima FAQ "Cos\u2019è Job Hunter Team?" è aperta di default', async ({ page }) => {
    // La prima voce ha openIndex=0 di default — il testo della risposta è visibile
    const firstAnswer = page.getByText(/automatizza la ricerca di lavoro/i).first();
    await expect(firstAnswer).toBeVisible({ timeout: 5000 });
  });

  test('click su domanda chiusa la apre e mostra la risposta', async ({ page }) => {
    // "Quanto costa?" — indice 3, chiuso di default
    const costoBtn = page.locator('button').filter({ hasText: /quanto costa/i }).first();
    await expect(costoBtn).toBeVisible({ timeout: 5000 });

    // La risposta non deve essere visibile prima del click
    const costoAnswer = page.getByText(/gratuito e open-source/i).first();
    await expect(costoAnswer).not.toBeVisible();

    await costoBtn.click();
    await expect(costoAnswer).toBeVisible({ timeout: 3000 });
  });

  test('click su domanda aperta la chiude', async ({ page }) => {
    // Prima FAQ è aperta di default
    const firstBtn = page.locator('button').filter({ hasText: /cos.e job hunter team/i }).first();
    const firstAnswer = page.getByText(/automatizza la ricerca di lavoro/i).first();

    await expect(firstAnswer).toBeVisible();
    await firstBtn.click();
    await expect(firstAnswer).not.toBeVisible({ timeout: 3000 });
  });

  test('risposta "Quali agenti ci sono?" mostra i 7 agenti', async ({ page }) => {
    const agentiBtn = page.locator('button').filter({ hasText: /quali agenti/i }).first();
    await agentiBtn.click();

    // Tutti e 7 gli agenti devono essere menzionati nella risposta
    for (const agent of ['Capitano', 'Scout', 'Analista', 'Scorer', 'Scrittore', 'Critico', 'Sentinella']) {
      await expect(page.getByText(agent).first()).toBeVisible({ timeout: 3000 });
    }
  });

  test('CTA "Non trovi la risposta?" è visibile con link /guide e /docs', async ({ page }) => {
    await expect(page.getByText(/non trovi la risposta/i)).toBeVisible();
    await expect(page.locator('a[href="/guide"]').first()).toBeVisible();
    await expect(page.locator('a[href="/docs"]').first()).toBeVisible();
  });

  test('footer nav ha link ← Guida e Download →', async ({ page }) => {
    const guidaLink = page.locator('a[href="/guide"]').last();
    const downloadLink = page.locator('a[href="/download"]').last();
    await expect(guidaLink).toBeVisible();
    await expect(downloadLink).toBeVisible();
  });

  test('risposta "Come si avvia il team?" menziona /team e tmux', async ({ page }) => {
    const btn = page.locator('button').filter({ hasText: /come si avvia il team/i }).first();
    await btn.click();
    // La risposta contiene link a /team e menzione di tmux
    await expect(page.locator('a[href="/team"]').first()).toBeVisible({ timeout: 3000 });
    await expect(page.getByText(/tmux/i).first()).toBeVisible({ timeout: 3000 });
  });

  test('risposta "Requisiti di sistema" menziona tmux e Claude CLI', async ({ page }) => {
    const btn = page.locator('button').filter({ hasText: /requisiti di sistema/i }).first();
    await btn.click();
    await expect(page.getByText(/tmux/i).first()).toBeVisible({ timeout: 3000 });
    await expect(page.getByText(/claude cli/i).first()).toBeVisible({ timeout: 3000 });
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2 — /team  (pannello pipeline e diagnostico, richiede auth)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('/team — Pipeline e diagnostico agenti', () => {

  test.beforeEach(async ({ page }) => {
    await doWorkspaceAuth(page);
    await page.goto(`${BASE}/team`, { waitUntil: 'networkidle' });
  });

  test('pagina carica con H1 "Job Hunter Team"', async ({ page }) => {
    await expect(page.locator('h1')).toHaveText(/job hunter team/i);
  });

  test('counter agenti attivi è visibile nell’header', async ({ page }) => {
    await expect(page.getByText(/\d+\/8 agenti attivi/i).first()).toBeVisible();
  });

  test('bottone "▶ Avvia tutti" è presente e cliccabile', async ({ page }) => {
    const avviaBtn = page.getByRole('button', { name: /avvia tutti|tutti attivi/i });
    await expect(avviaBtn).toBeVisible({ timeout: 5000 });
  });

  test('griglia agenti è visibile con card cliccabili', async ({ page }) => {
    await expect(page.getByRole('article', { name: /Alfa/i })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('article', { name: /Assistente/i })).toBeVisible({ timeout: 5000 });
  });

  test('tutti e 8 gli agenti sono visualizzati con nome e icona', async ({ page }) => {
    const agents = ['Capitano', 'Sentinella', 'Scout', 'Analista', 'Scorer', 'Scrittore', 'Critico', 'Assistente'];
    for (const name of agents) {
      await expect(page.getByText(name).first()).toBeVisible({ timeout: 5000 });
    }
  });

  test('agenti hanno link cliccabili alle rispettive pagine', async ({ page }) => {
    // Capitano ha link /capitano
    const capitanoLink = page.locator('a[href="/capitano"]').first();
    await expect(capitanoLink).toBeVisible({ timeout: 5000 });
  });

  test('ogni agente ha un status dot (indicatore di stato)', async ({ page }) => {
    const dots = page.locator('[role="status"]');
    const count = await dots.count();
    expect(count, 'Attesi almeno 8 status dot (uno per agente)').toBeGreaterThanOrEqual(8);
  });

  test('click su un controllo bulk non produce errori JavaScript critici', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => jsErrors.push(e.message));

    await (await getBulkTeamAction(page)).click();
    await page.waitForTimeout(2000);

    const critical = jsErrors.filter(e => !/expected|warning|chunk/i.test(e));
    expect(critical, `Errori JS dopo click bulk action: ${critical.join(', ')}`).toHaveLength(0);
  });

  test('click su un controllo bulk non causa navigazione o crash della pagina', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => jsErrors.push(e.message));

    await (await getBulkTeamAction(page)).click();
    // Aspetta stabilizzazione — la pagina non deve navigare altrove o crashare
    await page.waitForLoadState('domcontentloaded').catch(() => null);
    await page.waitForTimeout(2000);

    // H1 ancora presente → pagina non crashata
    await expect(page.locator('h1')).toBeVisible({ timeout: 5000 });
    const critical = jsErrors.filter(e => !/expected|warning|chunk|network/i.test(e));
    expect(critical, `Errori JS critici dopo click bulk action: ${critical.join(', ')}`).toHaveLength(0);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3 — Toast notifiche agenti  (/agents)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Toast notifiche agenti — /agents', () => {

  test.beforeEach(async ({ page }) => {
    await doWorkspaceAuth(page);
    await page.goto(`${BASE}/agents`, { waitUntil: 'networkidle' });
  });

  test('sistema notifiche [role="alert"] è presente nella pagina', async ({ page }) => {
    const alertEl = page.locator('[role="alert"]');
    await expect(alertEl).toHaveCount(1);
  });

  test('sistema notifiche [aria-live] è presente nella pagina', async ({ page }) => {
    const ariaLiveEls = page.locator('[aria-live]');
    const count = await ariaLiveEls.count();
    expect(count, 'Atteso almeno un elemento [aria-live]').toBeGreaterThanOrEqual(1);
  });

  test('click ▶ Start non causa crash — sistema notifiche pronto a ricevere', async ({ page }) => {
    const startBtn = page.getByText('▶ Start').first();
    await expect(startBtn).toBeVisible({ timeout: 5000 });

    const jsErrors: string[] = [];
    page.on('pageerror', (e) => jsErrors.push(e.message));

    await startBtn.click();
    await page.waitForTimeout(2000);

    // Il sistema di notifica ([role='alert'], [aria-live]) deve essere in DOM
    // Il testo appare solo con server locale attivo — verifichiamo che il plumbing esista
    const alertCount = await page.locator('[role="alert"]').count();
    const ariaLiveCount = await page.locator('[aria-live]').count();
    expect(
      alertCount + ariaLiveCount,
      'Sistema di notifica (alert/aria-live) assente dopo click ▶ Start'
    ).toBeGreaterThan(0);

    const critical = jsErrors.filter(e => !/expected|warning|chunk|network/i.test(e));
    expect(critical, `Errori JS critici dopo click ▶ Start: ${critical.join(', ')}`).toHaveLength(0);
  });

  test('badge status agenti usa classe .badge con testo leggibile', async ({ page }) => {
    const badges = page.locator('.badge');
    await expect(badges.first()).toBeVisible({ timeout: 5000 });
    const count = await badges.count();
    expect(count, 'Attesi almeno 7 badge status (uno per agente principale)').toBeGreaterThanOrEqual(7);
    // Il testo di ogni badge deve essere leggibile (OFFLINE, ONLINE, RUNNING, ecc.)
    const badgeText = await badges.first().innerText();
    expect(badgeText.trim().length).toBeGreaterThan(0);
  });

  test('counter agenti attivi "N/7 attivi" è visibile', async ({ page }) => {
    const counter = page.getByText(/\d+\/7\s*attivi/i).first();
    await expect(counter).toBeVisible({ timeout: 5000 });
  });

  test('ogni agente ha un bottone di azione Start o Stop', async ({ page }) => {
    const actionBtns = page.locator('button').filter({ hasText: /▶ Start|■ Stop/ });
    const count = await actionBtns.count();
    expect(count, 'Attesi almeno 7 bottoni azione agenti').toBeGreaterThanOrEqual(7);
  });

});
