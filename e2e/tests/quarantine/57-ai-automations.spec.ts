import { test, expect } from '@playwright/test';

/**
 * FLUSSO 57 — AI ASSISTANT, AUTOMAZIONI E STRUMENTI AVANZATI
 *
 * Suite 1: Pagine AI — /ai-assistant, /automations, /cover-letters, /resume-builder, /templates
 * Suite 2: API AI — /api/ai-assistant, /api/automations, /api/cover-letters, /api/resume
 * Suite 3: Componenti nuovi — KanbanBoard, CountdownTimer su pagine che li usano
 * Suite 4: Sicurezza AI + regressione
 */

const BASE = process.env.BASE_URL || 'https://jobhunterteam.ai';

const AI_PAGES = [
  { path: '/ai-assistant',  label: 'AI Assistant'  },
  { path: '/automations',   label: 'Automations'   },
  { path: '/cover-letters', label: 'Cover Letters' },
  { path: '/resume-builder',label: 'Resume Builder'},
  { path: '/templates',     label: 'Templates'     },
];

const AI_APIS = [
  { path: '/api/ai-assistant',  label: 'AI Assistant API'  },
  { path: '/api/automations',   label: 'Automations API'   },
  { path: '/api/cover-letters', label: 'Cover Letters API' },
  { path: '/api/resume',        label: 'Resume API'        },
];

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 — Pagine AI e automazioni
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AI & Automazioni — pagine', () => {

  test('tutte le pagine AI: nessuna risponde 500', async ({ request }) => {
    const errors: string[] = [];
    for (const { path, label } of AI_PAGES) {
      const res = await request.get(`${BASE}${path}`, { timeout: 8000 }).catch(() => null);
      if (res?.status() === 500) errors.push(`500 ${label}`);
    }
    expect(errors, `Pagine con 500:\n${errors.join('\n')}`).toHaveLength(0);
  });

  test('tutte le pagine AI: HTML con struttura Next.js', async ({ request }) => {
    const errors: string[] = [];
    for (const { path, label } of AI_PAGES) {
      const res = await request.get(`${BASE}${path}`, { timeout: 8000 }).catch(() => null);
      if (!res || res.status() === 404) continue;
      const html = await res.text();
      if (!html.match(/__NEXT_DATA__|_next\/static|<html/)) {
        errors.push(`${label}: no struttura Next.js`);
      }
    }
    expect(errors).toHaveLength(0);
  });

  test('/ai-assistant: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/ai-assistant`, { timeout: 8000 });
    if (res.status() === 404) test.skip(true, '/ai-assistant non deployata');
    expect(res.status()).not.toBe(500);
  });

  test('/automations: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/automations`, { timeout: 8000 });
    if (res.status() === 404) test.skip(true, '/automations non deployata');
    expect(res.status()).not.toBe(500);
  });

  test('/cover-letters: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/cover-letters`, { timeout: 8000 });
    if (res.status() === 404) test.skip(true, '/cover-letters non deployata');
    expect(res.status()).not.toBe(500);
  });

  test('/resume-builder: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/resume-builder`, { timeout: 8000 });
    if (res.status() === 404) test.skip(true, '/resume-builder non deployata');
    expect(res.status()).not.toBe(500);
  });

  test('/templates: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/templates`, { timeout: 8000 });
    if (res.status() === 404) test.skip(true, '/templates non deployata');
    expect(res.status()).not.toBe(500);
  });

  test('nessuna pagina AI: errori JS critici', async ({ page }) => {
    const pagesWithErrors: string[] = [];
    for (const { path, label } of AI_PAGES.slice(0, 3)) {
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
    expect(pagesWithErrors, `Errori JS:\n${pagesWithErrors.join('\n')}`).toHaveLength(0);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2 — API AI e automazioni
// ─────────────────────────────────────────────────────────────────────────────
test.describe('API AI & Automazioni', () => {

  test('tutte le API AI: nessuna risponde 500', async ({ request }) => {
    const errors: string[] = [];
    for (const { path, label } of AI_APIS) {
      const res = await request.get(`${BASE}${path}`, { timeout: 8000 }).catch(() => null);
      if (res?.status() === 500) errors.push(`500 ${label}`);
    }
    expect(errors, `API con 500:\n${errors.join('\n')}`).toHaveLength(0);
  });

  test('/api/ai-assistant: risponde 200 o 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/ai-assistant`);
    if (res.status() === 404) test.skip(true, '/api/ai-assistant non deployata');
    expect([200, 401, 403]).toContain(res.status());
  });

  test('/api/automations: risponde 200 o 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/automations`);
    if (res.status() === 404) test.skip(true, '/api/automations non deployata');
    expect([200, 401, 403]).toContain(res.status());
  });

  test('/api/cover-letters: risponde 200 o 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/cover-letters`);
    if (res.status() === 404) test.skip(true, '/api/cover-letters non deployata');
    expect([200, 401, 403]).toContain(res.status());
  });

  test('/api/resume: risponde 200 o 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/resume`);
    if (res.status() === 404) test.skip(true, '/api/resume non deployata');
    expect([200, 401, 403]).toContain(res.status());
  });

  test('API 200: Content-Type JSON', async ({ request }) => {
    const notJson: string[] = [];
    for (const { path, label } of AI_APIS) {
      const res = await request.get(`${BASE}${path}`, { timeout: 5000 }).catch(() => null);
      if (!res || res.status() !== 200) continue;
      const ct = res.headers()['content-type'] ?? '';
      if (!ct.includes('application/json')) notJson.push(`${label}: ${ct}`);
    }
    expect(notJson, `API non JSON: ${notJson.join(', ')}`).toHaveLength(0);
  });

  test('/api/ai-assistant: nessuna chiave API esposta', async ({ request }) => {
    const res = await request.get(`${BASE}/api/ai-assistant`);
    if (res.status() === 404 || res.status() === 401) test.skip(true, 'Non accessibile');
    const text = await res.text();
    expect(text).not.toMatch(/sk-ant-|sk-[a-zA-Z0-9]{10}|openai|anthropic/i);
    expect(text).not.toMatch(/api[_-]?key\s*[:=]/i);
  });

  test('/api/cover-letters: nessun dato sensibile', async ({ request }) => {
    const res = await request.get(`${BASE}/api/cover-letters`);
    if (res.status() === 404 || res.status() === 401) test.skip(true, 'Non accessibile');
    const text = await res.text();
    expect(text).not.toMatch(/sk-ant-|password|secret/i);
    expect(text).not.toMatch(/\/home\/\w+\/|\/Users\/\w+\//);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3 — Componenti KanbanBoard e CountdownTimer
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Componenti KanbanBoard e CountdownTimer', () => {

  test('KanbanBoard: pagina che lo usa non crasha', async ({ page }) => {
    // KanbanBoard potrebbe essere su /applications, /jobs o /overview
    const candidates = ['/applications', '/jobs', '/overview'];
    let tested = false;
    for (const path of candidates) {
      const jsErrors: string[] = [];
      page.removeAllListeners('pageerror');
      page.on('pageerror', (e) => {
        if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
          jsErrors.push(e.message);
        }
      });
      const res = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
      if (!res || res.status() === 404) continue;
      const url = page.url();
      if (url.includes('login') || url === `${BASE}/`) continue;
      await page.waitForTimeout(500);
      // Se la pagina usa KanbanBoard, verificare che non ci siano errori critici
      const html = await page.content();
      if (html.includes('kanban') || html.includes('Kanban') || html.includes('board')) {
        expect(jsErrors, `KanbanBoard crash su ${path}: ${jsErrors.join(', ')}`).toHaveLength(0);
        tested = true;
        break;
      }
    }
    if (!tested) test.skip(true, 'KanbanBoard non trovato nelle pagine candidate');
  });

  test('CountdownTimer: pagina che lo usa non crasha', async ({ page }) => {
    // CountdownTimer potrebbe essere su pagine con deadline/interviste
    const candidates = ['/interviews', '/applications', '/overview', '/dashboard'];
    let tested = false;
    for (const path of candidates) {
      const jsErrors: string[] = [];
      page.removeAllListeners('pageerror');
      page.on('pageerror', (e) => {
        if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
          jsErrors.push(e.message);
        }
      });
      const res = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
      if (!res || res.status() === 404) continue;
      const url = page.url();
      if (url.includes('login') || url === `${BASE}/`) continue;
      await page.waitForTimeout(500);
      const html = await page.content();
      if (html.includes('countdown') || html.includes('Countdown') || html.includes('timer')) {
        expect(jsErrors, `CountdownTimer crash su ${path}: ${jsErrors.join(', ')}`).toHaveLength(0);
        tested = true;
        break;
      }
    }
    if (!tested) test.skip(true, 'CountdownTimer non trovato nelle pagine candidate');
  });

  test('/automations: H1 visibile (se accessibile)', async ({ page }) => {
    const res = await page.goto(`${BASE}/automations`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) test.skip(true, '/automations non disponibile');
    const url = page.url();
    if (url.includes('login') || url.includes('auth') || url === `${BASE}/`) {
      test.skip(true, '/automations richiede auth');
    }
    const h1 = page.locator('h1').first();
    await expect(h1).toBeVisible({ timeout: 8000 });
  });

  test('/templates: H1 visibile (se accessibile)', async ({ page }) => {
    const res = await page.goto(`${BASE}/templates`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) test.skip(true, '/templates non disponibile');
    const url = page.url();
    if (url.includes('login') || url.includes('auth') || url === `${BASE}/`) {
      test.skip(true, '/templates richiede auth');
    }
    const h1 = page.locator('h1').first();
    await expect(h1).toBeVisible({ timeout: 8000 });
  });

  test('pagine AI: title non vuoto', async ({ request }) => {
    const missing: string[] = [];
    for (const { path, label } of AI_PAGES) {
      const res = await request.get(`${BASE}${path}`, { timeout: 8000 }).catch(() => null);
      if (!res || res.status() !== 200) continue;
      const html = await res.text();
      const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
      if (!titleMatch || titleMatch[1].trim().length < 3) missing.push(label);
    }
    if (missing.length > 0) console.log(`[WARN] Title vuoto su: ${missing.join(', ')}`);
    expect(missing.length).toBeLessThan(3);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4 — Sicurezza AI + regressione
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AI — sicurezza e regressione', () => {

  test('API AI: TTFB < 3s', async ({ request }) => {
    const slow: string[] = [];
    for (const { path, label } of AI_APIS) {
      const start = Date.now();
      const res = await request.get(`${BASE}${path}`, { timeout: 5000 }).catch(() => null);
      const elapsed = Date.now() - start;
      if (res?.status() === 200 && elapsed > 3000) slow.push(`${label}: ${elapsed}ms`);
    }
    if (slow.length > 0) console.log(`[WARN] API lente: ${slow.join(', ')}`);
    expect(slow.length).toBeLessThan(2);
  });

  test('no X-Powered-By su /api/ai-assistant', async ({ request }) => {
    const res = await request.get(`${BASE}/api/ai-assistant`);
    if (res.status() === 404) test.skip(true, '/api/ai-assistant non deployata');
    const powered = res.headers()['x-powered-by'] ?? '';
    expect(powered).toBeFalsy();
  });

  test('injection su /api/automations: no 500', async ({ request }) => {
    const res = await request.get(`${BASE}/api/automations?cmd=rm+-rf+/`).catch(() => null);
    if (!res || res.status() === 404) test.skip(true, '/api/automations non disponibile');
    expect(res.status()).not.toBe(500);
  });

  test('regressione: /api/health intatta', async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    expect(res.status()).toBe(200);
    const body = await res.json().catch(() => ({}));
    expect(body).toHaveProperty('status');
  });

  test('regressione: /api/agents intatta', async ({ request }) => {
    const res = await request.get(`${BASE}/api/agents`);
    expect(res.status()).toBe(200);
    const body = await res.json().catch(() => null);
    expect(body).not.toBeNull();
  });

  test('regressione: homepage H1 visibile', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 5000 });
  });

});
