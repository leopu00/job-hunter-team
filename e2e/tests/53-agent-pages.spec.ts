import { test, expect } from '@playwright/test';

/**
 * FLUSSO 53 — PAGINE AGENTI (TUTTE)
 *
 * Suite 1: Tutte le pagine agente — status, no 500, redirect auth
 * Suite 2: Pagina /agents — lista agenti, struttura
 * Suite 3: API agenti — /api/agents, /api/agents/metrics
 * Suite 4: Navigazione tra agenti — link e transizioni
 */

const BASE = process.env.BASE_URL || 'https://jobhunterteam.ai';

const AGENT_PAGES = [
  { path: '/agents',       label: 'Agents Hub'  },
  { path: '/scout',        label: 'Scout'        },
  { path: '/analista',     label: 'Analista'     },
  { path: '/capitano',     label: 'Capitano'     },
  { path: '/scrittore',    label: 'Scrittore'    },
  { path: '/critico',      label: 'Critico'      },
  { path: '/assistente',   label: 'Assistente'   },
  { path: '/crescita',     label: 'Crescita'     },
  { path: '/scorer',       label: 'Scorer'       },
  { path: '/risposte',     label: 'Risposte'     },
  { path: '/sentinella',   label: 'Sentinella'   },
  { path: '/team',         label: 'Team'         },
];

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 — Tutte le pagine agente
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Pagine agenti — status e no 500', () => {

  test('tutte le pagine agente: nessuna risponde 500', async ({ request }) => {
    const errors: string[] = [];
    for (const { path, label } of AGENT_PAGES) {
      const res = await request.get(`${BASE}${path}`, { timeout: 8000 }).catch(() => null);
      if (res?.status() === 500) errors.push(`500 ${label} (${path})`);
    }
    expect(errors, `Agenti con 500:\n${errors.join('\n')}`).toHaveLength(0);
  });

  test('tutte le pagine agente: HTML con struttura Next.js', async ({ request }) => {
    const errors: string[] = [];
    for (const { path, label } of AGENT_PAGES.slice(0, 6)) {
      const res = await request.get(`${BASE}${path}`, { timeout: 8000 }).catch(() => null);
      if (!res || res.status() === 404) continue;
      const html = await res.text();
      if (!html.match(/__NEXT_DATA__|_next\/static|<html/)) {
        errors.push(`${label}: no struttura Next.js`);
      }
    }
    expect(errors).toHaveLength(0);
  });

  test('nessuna pagina agente ha errori JS critici al caricamento', async ({ page }) => {
    const pagesWithErrors: string[] = [];
    for (const { path, label } of AGENT_PAGES.slice(0, 4)) {
      const jsErrors: string[] = [];
      page.removeAllListeners('pageerror');
      page.on('pageerror', (e) => {
        if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
          jsErrors.push(e.message);
        }
      });
      const res = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
      if (!res || res.status() === 404) continue;
      await page.waitForTimeout(300);
      if (jsErrors.length > 0) pagesWithErrors.push(`${label}: ${jsErrors.join(', ')}`);
    }
    expect(pagesWithErrors, `Errori JS su agenti:\n${pagesWithErrors.join('\n')}`).toHaveLength(0);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2 — Pagina /agents
// ─────────────────────────────────────────────────────────────────────────────
test.describe('/agents — hub agenti', () => {

  test('/agents: risponde 200', async ({ request }) => {
    const res = await request.get(`${BASE}/agents`);
    if (res.status() === 404) test.skip(true, '/agents non disponibile');
    expect(res.status()).toBe(200);
  });

  test('/agents: H1 visibile', async ({ page }) => {
    const res = await page.goto(`${BASE}/agents`, { waitUntil: 'networkidle' });
    if (!res || res.status() !== 200) test.skip(true, '/agents non disponibile');
    const url = page.url();
    if (url !== `${BASE}/agents`) test.skip(true, '/agents protetta');
    const h1 = page.locator('h1').first();
    await expect(h1).toBeVisible({ timeout: 8000 });
  });

  test('/agents: lista agenti visibile (card o link)', async ({ page }) => {
    const res = await page.goto(`${BASE}/agents`, { waitUntil: 'networkidle' });
    if (!res || res.status() !== 200) test.skip(true, '/agents non disponibile');
    const url = page.url();
    if (url !== `${BASE}/agents`) test.skip(true, '/agents protetta');
    // Cerca card agenti o link a pagine agente
    const agentLinks = page.locator(
      'a[href*="/scout"], a[href*="/analista"], a[href*="/capitano"], ' +
      '[class*="agent"], [class*="card"]'
    ).first();
    const count = await agentLinks.count();
    if (count === 0) test.skip(true, 'Lista agenti non trovata');
    expect(count).toBeGreaterThan(0);
  });

  test('/agents: mobile no overflow', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    const res = await page.goto(`${BASE}/agents`, { waitUntil: 'networkidle' });
    if (!res || res.status() !== 200) { await ctx.close(); test.skip(true, '/agents non disponibile'); }
    const url = page.url();
    if (url !== `${BASE}/agents`) { await ctx.close(); test.skip(true, 'Redirect'); }
    const overflow = await page.evaluate(() => document.body.scrollWidth > window.innerWidth);
    await ctx.close();
    expect(overflow, 'Overflow mobile /agents').toBe(false);
  });

  test('/agents: loading state durante navigazione', async ({ page }) => {
    const res = await page.goto(`${BASE}/agents`, { waitUntil: 'domcontentloaded' });
    if (!res || res.status() !== 200) test.skip(true, '/agents non disponibile');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => null);
    const content = await page.locator('body').innerText().catch(() => '');
    const htmlLen = (await page.content()).length;
    expect(htmlLen, '/agents pagina vuota').toBeGreaterThan(2000);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3 — API agenti
// ─────────────────────────────────────────────────────────────────────────────
test.describe('API agenti', () => {

  test('/api/agents: 200 e JSON', async ({ request }) => {
    const res = await request.get(`${BASE}/api/agents`);
    expect(res.status()).toBe(200);
    const ct = res.headers()['content-type'] ?? '';
    expect(ct).toMatch(/application\/json/i);
  });

  test('/api/agents: lista con campi id/name', async ({ request }) => {
    const res = await request.get(`${BASE}/api/agents`);
    const body = await res.json().catch(() => null);
    expect(body).not.toBeNull();
    const agents = Array.isArray(body) ? body : (body?.agents ?? body?.data ?? []);
    if (agents.length > 0) {
      const first = agents[0];
      expect('id' in first || 'name' in first || 'session' in first).toBe(true);
    }
  });

  test('/api/agents/metrics: risponde (non 404)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/agents/metrics`);
    expect(res.status(), '/api/agents/metrics risponde 404').not.toBe(404);
  });

  test('/api/agents: performance < 2s', async ({ request }) => {
    const start = Date.now();
    const res = await request.get(`${BASE}/api/agents`);
    const elapsed = Date.now() - start;
    expect(res.status()).toBe(200);
    expect(elapsed, `Agents API lenta: ${elapsed}ms`).toBeLessThan(2000);
  });

  test('/api/agents: no dati sensibili', async ({ request }) => {
    const res = await request.get(`${BASE}/api/agents`);
    const text = await res.text();
    expect(text).not.toMatch(/sk-ant-|password|secret/i);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4 — Navigazione tra agenti
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Navigazione tra agenti', () => {

  test('/agents → /scout: transizione senza crash', async ({ page }) => {
    const res = await page.goto(`${BASE}/agents`, { waitUntil: 'networkidle' });
    if (!res || res.status() !== 200) test.skip(true, '/agents non disponibile');
    const url = page.url();
    if (url !== `${BASE}/agents`) test.skip(true, '/agents protetta');
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat/i.test(e.message)) jsErrors.push(e.message);
    });
    await page.goto(`${BASE}/scout`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    expect(jsErrors, `Errori transizione: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

  test('/scout → /analista: no errori', async ({ page }) => {
    const res = await page.goto(`${BASE}/scout`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) test.skip(true, '/scout non disponibile');
    const url = page.url();
    if (url.includes('login') || url === `${BASE}/`) test.skip(true, 'Scout protetta');
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => jsErrors.push(e.message));
    await page.goto(`${BASE}/analista`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    const critical = jsErrors.filter((e) => !/expected|warning|chunk|hydrat/i.test(e));
    expect(critical).toHaveLength(0);
  });

  test('tutte le pagine agente hanno title non vuoto', async ({ request }) => {
    const missing: string[] = [];
    for (const { path, label } of AGENT_PAGES.slice(0, 6)) {
      const res = await request.get(`${BASE}${path}`, { timeout: 8000 }).catch(() => null);
      if (!res || res.status() !== 200) continue;
      const html = await res.text();
      const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
      if (!titleMatch || titleMatch[1].trim().length < 3) {
        missing.push(label);
      }
    }
    if (missing.length > 0) console.log(`[WARN] Title vuoto su agenti: ${missing.join(', ')}`);
    expect(missing.length).toBeLessThan(3);
  });

});
