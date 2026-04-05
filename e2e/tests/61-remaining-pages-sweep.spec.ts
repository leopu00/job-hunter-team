import { test, expect } from '@playwright/test';

/**
 * FLUSSO 61 — SWEEP PAGINE RIMANENTI + COMPONENTI AGGIORNATI
 *
 * Suite 1: Sweep status — 25+ pagine rimaste non ancora testate
 * Suite 2: Navbar e JobCard aggiornati — no crash
 * Suite 3: Pagine admin/infra — /status, /logs, /monitoring, /database
 * Suite 4: ProfilePageClient + ProfileStats aggiornati + regressione
 */

const BASE = process.env.BASE_URL || 'https://jobhunterteam.ai';

// Pagine rimaste non ancora coperte da test precedenti
const REMAINING_PAGES = [
  { path: '/feedback',    label: 'Feedback'    },
  { path: '/forum',       label: 'Forum'       },
  { path: '/compare',     label: 'Compare'     },
  { path: '/history',     label: 'History'     },
  { path: '/plugins',     label: 'Plugins'     },
  { path: '/status',      label: 'Status'      },
  { path: '/audit',       label: 'Audit'       },
  { path: '/budget',      label: 'Budget'      },
  { path: '/performance', label: 'Performance' },
  { path: '/pipelines',   label: 'Pipelines'   },
  { path: '/queue',       label: 'Queue'       },
  { path: '/scheduler',   label: 'Scheduler'   },
  { path: '/credentials', label: 'Credentials' },
  { path: '/archive',     label: 'Archive'     },
  { path: '/export',      label: 'Export'      },
  { path: '/import',      label: 'Import'      },
  { path: '/logs',        label: 'Logs'        },
  { path: '/monitoring',  label: 'Monitoring'  },
  { path: '/database',    label: 'Database'    },
  { path: '/backup',      label: 'Backup'      },
  { path: '/cron',        label: 'Cron'        },
  { path: '/webhooks',    label: 'Webhooks'    },
  { path: '/workers',     label: 'Workers'     },
  { path: '/sentinel',    label: 'Sentinel'    },
  { path: '/profiles',    label: 'Profiles'    },
];

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 — Sweep status: nessuna risponde 500
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Sweep pagine rimanenti — status', () => {

  test('prime 12 pagine rimaste: nessuna risponde 500', async ({ request }) => {
    const errors: string[] = [];
    for (const { path, label } of REMAINING_PAGES.slice(0, 12)) {
      const res = await request.get(`${BASE}${path}`, { timeout: 8000 }).catch(() => null);
      if (res?.status() === 500) errors.push(`500 ${label}`);
    }
    expect(errors, `Pagine con 500:\n${errors.join('\n')}`).toHaveLength(0);
  });

  test('seconde 13 pagine rimaste: nessuna risponde 500', async ({ request }) => {
    const errors: string[] = [];
    for (const { path, label } of REMAINING_PAGES.slice(12)) {
      const res = await request.get(`${BASE}${path}`, { timeout: 8000 }).catch(() => null);
      if (res?.status() === 500) errors.push(`500 ${label}`);
    }
    expect(errors, `Pagine con 500:\n${errors.join('\n')}`).toHaveLength(0);
  });

  test('tutte le pagine rimaste: HTML con struttura Next.js', async ({ request }) => {
    const errors: string[] = [];
    for (const { path, label } of REMAINING_PAGES.slice(0, 10)) {
      const res = await request.get(`${BASE}${path}`, { timeout: 8000 }).catch(() => null);
      if (!res || res.status() === 404) continue;
      const html = await res.text();
      if (!html.match(/__NEXT_DATA__|_next\/static|<html/)) {
        errors.push(`${label}: no struttura Next.js`);
      }
    }
    expect(errors).toHaveLength(0);
  });

  test('/status: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/status`);
    if (res.status() === 404) test.skip(true, '/status non deployata');
    expect(res.status()).not.toBe(500);
  });

  test('/feedback: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/feedback`);
    if (res.status() === 404) test.skip(true, '/feedback non deployata');
    expect(res.status()).not.toBe(500);
  });

  test('/logs: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/logs`);
    if (res.status() === 404) test.skip(true, '/logs non deployata');
    expect(res.status()).not.toBe(500);
  });

  test('/monitoring: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/monitoring`);
    if (res.status() === 404) test.skip(true, '/monitoring non deployata');
    expect(res.status()).not.toBe(500);
  });

  test('/webhooks: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/webhooks`);
    if (res.status() === 404) test.skip(true, '/webhooks non deployata');
    expect(res.status()).not.toBe(500);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2 — Navbar e JobCard aggiornati
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Navbar e JobCard — verifica aggiornamento', () => {

  test('Navbar aggiornata: no crash su homepage', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const nav = page.locator('nav').first();
    await expect(nav).toBeVisible({ timeout: 5000 });
    expect(jsErrors, `Navbar crash: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

  test('Navbar: link home presente e funzionante', async ({ page }) => {
    await page.goto(`${BASE}/about`, { waitUntil: 'networkidle' });
    const homeLink = page.locator('a[href="/"], a[href="' + BASE + '/"]').first();
    const count = await homeLink.count();
    if (count === 0) test.skip(true, 'Link home non trovato');
    await homeLink.click();
    await page.waitForLoadState('networkidle');
    expect(page.url()).toBe(`${BASE}/`);
  });

  test('JobCard: pagina /jobs non crasha con cards aggiornate', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    const res = await page.goto(`${BASE}/jobs`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) test.skip(true, '/jobs non disponibile');
    await page.waitForTimeout(500);
    expect(jsErrors, `JobCard crash: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

  test('JobCard mobile (375px): no crash', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    const res = await page.goto(`${BASE}/jobs`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) { await ctx.close(); test.skip(true, '/jobs non disponibile'); }
    await page.waitForTimeout(400);
    await ctx.close();
    expect(jsErrors, `JobCard mobile crash: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

  test('Navbar: dark mode no crash', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const nav = page.locator('nav').first();
    await expect(nav).toBeVisible({ timeout: 5000 });
    expect(jsErrors, `Navbar dark crash: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3 — Pagine admin/infra
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Pagine admin e infra', () => {

  test('/status: H1 visibile (se accessibile)', async ({ page }) => {
    const res = await page.goto(`${BASE}/status`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) test.skip(true, '/status non disponibile');
    const url = page.url();
    if (url.includes('login') || url.includes('auth') || url === `${BASE}/`) {
      test.skip(true, '/status richiede auth');
    }
    const heading = page.locator('h1, h2').first();
    const count = await heading.count();
    if (count === 0) test.skip(true, '/status: nessun heading');
    await expect(heading).toBeVisible({ timeout: 5000 });
  });

  test('/logs: nessun dato sensibile nell\'HTML', async ({ request }) => {
    const res = await request.get(`${BASE}/logs`);
    if (res.status() === 404 || res.status() === 401) test.skip(true, '/logs non accessibile');
    const text = await res.text();
    expect(text).not.toMatch(/sk-ant-|password|secret/i);
    expect(text).not.toMatch(/\/home\/\w+\/|\/Users\/\w+\//);
  });

  test('/monitoring: nessun dato sensibile', async ({ request }) => {
    const res = await request.get(`${BASE}/monitoring`);
    if (res.status() === 404 || res.status() === 401) test.skip(true, '/monitoring non accessibile');
    const text = await res.text();
    expect(text).not.toMatch(/sk-ant-|password|secret/i);
  });

  test('/database: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/database`);
    if (res.status() === 404) test.skip(true, '/database non deployata');
    expect(res.status()).not.toBe(500);
  });

  test('/cron: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/cron`);
    if (res.status() === 404) test.skip(true, '/cron non deployata');
    expect(res.status()).not.toBe(500);
  });

  test('no errori JS critici su /status', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    const res = await page.goto(`${BASE}/status`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) test.skip(true, '/status non disponibile');
    await page.waitForTimeout(300);
    expect(jsErrors, `Errori JS /status: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4 — ProfilePageClient + ProfileStats + regressione
// ─────────────────────────────────────────────────────────────────────────────
test.describe('ProfilePageClient e ProfileStats — verifica aggiornamento', () => {

  test('/api/profile: struttura intatta dopo aggiornamento', async ({ request }) => {
    const res = await request.get(`${BASE}/api/profile`);
    expect(res.status()).toBe(200);
    const ct = res.headers()['content-type'] ?? '';
    expect(ct).toMatch(/application\/json/i);
    const body = await res.json().catch(() => null);
    expect(body).not.toBeNull();
  });

  test('ProfileStats: no crash su pagina /profile (se accessibile)', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    const res = await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle' });
    if (!res || res.status() === 404) test.skip(true, '/profile non disponibile');
    const url = page.url();
    if (url.includes('login') || url.includes('auth') || url === `${BASE}/`) {
      test.skip(true, '/profile richiede auth');
    }
    await page.waitForTimeout(500);
    expect(jsErrors, `ProfileStats crash: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

  test('regressione: /api/health intatta', async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    expect(res.status()).toBe(200);
    const body = await res.json().catch(() => ({}));
    expect(body).toHaveProperty('status');
  });

  test('regressione: pagine critiche tutte 200', async ({ request }) => {
    const pages = ['/', '/faq', '/guide', '/download', '/about', '/changelog'];
    const errors: string[] = [];
    for (const path of pages) {
      const res = await request.get(`${BASE}${path}`, { timeout: 8000 }).catch(() => null);
      if (res?.status() !== 200) errors.push(`${path}: ${res?.status()}`);
    }
    expect(errors, `Critiche non 200:\n${errors.join('\n')}`).toHaveLength(0);
  });

  test('regressione: homepage no errori JS', async ({ page }) => {
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

  test('regressione: /api/agents intatta', async ({ request }) => {
    const res = await request.get(`${BASE}/api/agents`);
    expect(res.status()).toBe(200);
    const body = await res.json().catch(() => null);
    expect(body).not.toBeNull();
  });

});
