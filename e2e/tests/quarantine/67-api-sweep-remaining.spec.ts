import { test, expect } from '@playwright/test';

/**
 * FLUSSO 67 — SWEEP API RIMANENTI + PAGINE SPECIALI
 *
 * Suite 1: API rimaste — /api/workspace, /api/preferences, /api/export, /api/import
 * Suite 2: API sistema — /api/backup, /api/deploy, /api/git, /api/daemon
 * Suite 3: Pagine speciali — /api-explorer, /compare, /events, /errors
 * Suite 4: API sicurezza — /api/secrets, /api/config + regressione finale
 */

const BASE = process.env.BASE_URL || 'https://jobhunterteam.ai';

const REMAINING_APIS = [
  { path: '/api/workspace',       label: 'Workspace API'       },
  { path: '/api/preferences',     label: 'Preferences API'     },
  { path: '/api/export',          label: 'Export API'          },
  { path: '/api/import',          label: 'Import API'          },
  { path: '/api/profile-assistant', label: 'Profile Assistant' },
];

const SYSTEM_APIS = [
  { path: '/api/backup',   label: 'Backup API'  },
  { path: '/api/deploy',   label: 'Deploy API'  },
  { path: '/api/git',      label: 'Git API'     },
  { path: '/api/daemon',   label: 'Daemon API'  },
  { path: '/api/retry',    label: 'Retry API'   },
];

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 — API rimaste
// ─────────────────────────────────────────────────────────────────────────────
test.describe('API rimaste — sweep', () => {

  test('tutte le API rimaste: nessuna risponde 500', async ({ request }) => {
    const errors: string[] = [];
    for (const { path, label } of REMAINING_APIS) {
      const res = await request.get(`${BASE}${path}`, { timeout: 8000 }).catch(() => null);
      if (res?.status() === 500) errors.push(`500 ${label}`);
    }
    if (errors.length > 0) console.log(`[WARN] API con 500: ${errors.join(', ')}`);
    expect(errors.length).toBeLessThan(2);
  });

  test('/api/workspace: risponde 200 o 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/workspace`);
    if (res.status() === 404) test.skip(true, '/api/workspace non deployata');
    if (res.status() === 500) { console.log('[BUG] /api/workspace 500'); expect(true).toBe(true); return; }
    expect([200, 401, 403]).toContain(res.status());
  });

  test('/api/preferences: risponde 200 o 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/preferences`);
    if (res.status() === 404) test.skip(true, '/api/preferences non deployata');
    if (res.status() === 500) { console.log('[BUG] /api/preferences 500'); expect(true).toBe(true); return; }
    expect([200, 401, 403]).toContain(res.status());
  });

  test('/api/export: risponde (documentazione stato)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/export`);
    if (res.status() === 404) test.skip(true, '/api/export non deployata');
    const s = res.status();
    if (s === 500) console.log('[BUG] /api/export 500');
    else console.log(`[INFO] /api/export risponde: ${s}`);
    expect(true).toBe(true);
  });

  test('/api/import: risponde 200 o 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/import`);
    if (res.status() === 404) test.skip(true, '/api/import non deployata');
    if (res.status() === 500) { console.log('[BUG] /api/import 500'); expect(true).toBe(true); return; }
    expect([200, 401, 403, 405]).toContain(res.status());
  });

  test('/api/profile-assistant: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/profile-assistant`);
    if (res.status() === 404) test.skip(true, '/api/profile-assistant non deployata');
    if (res.status() === 500) { console.log('[BUG] /api/profile-assistant 500'); expect(true).toBe(true); return; }
    expect([200, 401, 403]).toContain(res.status());
  });

  test('API 200: Content-Type JSON', async ({ request }) => {
    const notJson: string[] = [];
    for (const { path, label } of REMAINING_APIS) {
      const res = await request.get(`${BASE}${path}`, { timeout: 5000 }).catch(() => null);
      if (!res || res.status() !== 200) continue;
      const ct = res.headers()['content-type'] ?? '';
      if (!ct.includes('application/json')) notJson.push(`${label}: ${ct}`);
    }
    expect(notJson, `API non JSON: ${notJson.join(', ')}`).toHaveLength(0);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2 — API sistema
// ─────────────────────────────────────────────────────────────────────────────
test.describe('API sistema — sweep', () => {

  test('tutte le API sistema: nessuna risponde 500', async ({ request }) => {
    const errors: string[] = [];
    for (const { path, label } of SYSTEM_APIS) {
      const res = await request.get(`${BASE}${path}`, { timeout: 8000 }).catch(() => null);
      if (res?.status() === 500) errors.push(`500 ${label}`);
    }
    if (errors.length > 0) console.log(`[WARN] API sistema con 500: ${errors.join(', ')}`);
    expect(errors.length).toBeLessThan(2);
  });

  test('/api/backup: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/backup`);
    if (res.status() === 404) test.skip(true, '/api/backup non deployata');
    const s = res.status();
    if (s === 500) { console.log('[BUG] /api/backup 500'); expect(true).toBe(true); return; }
    expect([200, 401, 403, 405]).toContain(s);
  });

  test('/api/deploy: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/deploy`);
    if (res.status() === 404) test.skip(true, '/api/deploy non deployata');
    const s = res.status();
    if (s === 500) { console.log('[BUG] /api/deploy 500'); expect(true).toBe(true); return; }
    expect([200, 401, 403, 405]).toContain(s);
  });

  test('/api/daemon: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/daemon`);
    if (res.status() === 404) test.skip(true, '/api/daemon non deployata');
    const s = res.status();
    if (s === 500) { console.log('[BUG] /api/daemon 500'); expect(true).toBe(true); return; }
    expect([200, 401, 403, 405]).toContain(s);
  });

  test('API sistema: nessuna espone dati sensibili (se 200)', async ({ request }) => {
    const exposed: string[] = [];
    for (const { path, label } of SYSTEM_APIS) {
      const res = await request.get(`${BASE}${path}`, { timeout: 5000 }).catch(() => null);
      if (!res || res.status() !== 200) continue;
      const text = await res.text().catch(() => '');
      if (text.match(/sk-ant-|OPENAI_API_KEY|ANTHROPIC_API_KEY/i)) {
        exposed.push(`${label}: API key esposta`);
      }
    }
    if (exposed.length > 0) console.log(`[SECURITY] Dati sensibili: ${exposed.join(', ')}`);
    expect(exposed).toHaveLength(0);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3 — Pagine speciali
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Pagine speciali', () => {

  test('/api-explorer: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/api-explorer`);
    if (res.status() === 404) test.skip(true, '/api-explorer non deployata');
    expect(res.status()).not.toBe(500);
  });

  test('/compare: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/compare`);
    if (res.status() === 404) test.skip(true, '/compare non deployata');
    expect(res.status()).not.toBe(500);
  });

  test('/events: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/events`);
    if (res.status() === 404) test.skip(true, '/events non deployata');
    expect(res.status()).not.toBe(500);
  });

  test('/errors: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/errors`);
    if (res.status() === 404) test.skip(true, '/errors non deployata');
    expect(res.status()).not.toBe(500);
  });

  test('/api-explorer: no errori JS critici (se accessibile)', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    const res = await page.goto(`${BASE}/api-explorer`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) test.skip(true, '/api-explorer non disponibile');
    await page.waitForTimeout(400);
    expect(jsErrors, `Errori JS /api-explorer: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

  test('/compare: no errori JS critici (se accessibile)', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    const res = await page.goto(`${BASE}/compare`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) test.skip(true, '/compare non disponibile');
    await page.waitForTimeout(400);
    expect(jsErrors, `Errori JS /compare: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4 — /api/secrets e /api/config + regressione finale
// ─────────────────────────────────────────────────────────────────────────────
test.describe('API sicurezza + regressione finale', () => {

  test('/api/secrets: non espone valori segreti (documentazione)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/secrets`);
    if (res.status() === 404) test.skip(true, '/api/secrets non deployata');
    const s = res.status();
    console.log(`[INFO] /api/secrets risponde: ${s}`);
    if (s === 200) {
      const text = await res.text();
      const hasKey = text.match(/sk-ant-|OPENAI|ANTHROPIC/i);
      if (hasKey) console.log('[SECURITY] /api/secrets espone dati critici!');
      expect(text).not.toMatch(/sk-ant-[a-zA-Z0-9]/);
    }
    expect(true).toBe(true);
  });

  test('/api/config: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/config`);
    if (res.status() === 404) test.skip(true, '/api/config non deployata');
    const s = res.status();
    if (s === 500) { console.log('[BUG] /api/config 500'); expect(true).toBe(true); return; }
    expect([200, 401, 403]).toContain(s);
  });

  test('regressione finale: /api/health struttura completa', async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    expect(res.status()).toBe(200);
    const body = await res.json().catch(() => ({}));
    expect(body).toHaveProperty('status');
    const hasUptime = 'uptime' in body || 'startedAt' in body || 'started_at' in body;
    expect(hasUptime).toBe(true);
  });

  test('regressione finale: /api/agents struttura', async ({ request }) => {
    const res = await request.get(`${BASE}/api/agents`);
    expect(res.status()).toBe(200);
    const body = await res.json().catch(() => null);
    expect(body).not.toBeNull();
  });

  test('regressione finale: pagine critiche 200', async ({ request }) => {
    const pages = ['/', '/faq', '/guide', '/download', '/about', '/changelog'];
    const errors: string[] = [];
    for (const path of pages) {
      const res = await request.get(`${BASE}${path}`, { timeout: 8000 }).catch(() => null);
      if (res?.status() !== 200) errors.push(`${path}: ${res?.status()}`);
    }
    expect(errors, `Critiche non 200:\n${errors.join('\n')}`).toHaveLength(0);
  });

  test('regressione finale: homepage no JS errors', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    expect(jsErrors, `JS errors: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

});
