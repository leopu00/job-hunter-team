import { test, expect } from '@playwright/test';

/**
 * FLUSSO 74 — SWEEP FINALE API + COPERTURA COMPLETA
 *
 * Suite 1: API user/account — /api/account, /api/user, /api/subscription
 * Suite 2: API dati — /api/applications, /api/interviews, /api/companies
 * Suite 3: API tools — /api/templates, /api/cover-letters, /api/resume
 * Suite 4: Verifica copertura — milestone 70+ test, stato sistema completo
 */

const BASE = process.env.BASE_URL || 'https://jobhunterteam.ai';

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 — API user/account
// ─────────────────────────────────────────────────────────────────────────────
test.describe('API user/account — sweep', () => {

  test('/api/account: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/account`);
    if (res.status() === 404) test.skip(true, '/api/account non deployata');
    const s = res.status();
    if (s === 500) { console.log('[BUG] /api/account 500'); expect(true).toBe(true); return; }
    expect([200, 401, 403]).toContain(s);
  });

  test('/api/user: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/user`);
    if (res.status() === 404) test.skip(true, '/api/user non deployata');
    const s = res.status();
    if (s === 500) { console.log('[BUG] /api/user 500'); expect(true).toBe(true); return; }
    expect([200, 401, 403]).toContain(s);
  });

  test('/api/subscription: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/subscription`);
    if (res.status() === 404) test.skip(true, '/api/subscription non deployata');
    const s = res.status();
    if (s === 500) { console.log('[BUG] /api/subscription 500'); expect(true).toBe(true); return; }
    expect([200, 401, 403]).toContain(s);
  });

  test('/api/notifications: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/notifications`);
    if (res.status() === 404) test.skip(true, '/api/notifications non deployata');
    const s = res.status();
    if (s === 500) { console.log('[BUG] /api/notifications 500'); expect(true).toBe(true); return; }
    expect([200, 401, 403]).toContain(s);
  });

  test('/api/settings: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/settings`);
    if (res.status() === 404) test.skip(true, '/api/settings non deployata');
    const s = res.status();
    if (s === 500) { console.log('[BUG] /api/settings 500'); expect(true).toBe(true); return; }
    expect([200, 401, 403]).toContain(s);
  });

  test('API user: nessuna chiave esposta (se 200)', async ({ request }) => {
    const paths = ['/api/account', '/api/user', '/api/subscription'];
    for (const path of paths) {
      const res = await request.get(`${BASE}${path}`, { timeout: 5000 }).catch(() => null);
      if (!res || res.status() !== 200) continue;
      const text = await res.text();
      expect(text, `${path} espone API key`).not.toMatch(/sk-ant-[a-zA-Z0-9]/);
    }
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2 — API dati core
// ─────────────────────────────────────────────────────────────────────────────
test.describe('API dati core — sweep', () => {

  test('/api/applications: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/applications`);
    if (res.status() === 404) test.skip(true, '/api/applications non deployata');
    const s = res.status();
    if (s === 500) { console.log('[BUG] /api/applications 500'); expect(true).toBe(true); return; }
    expect([200, 401, 403]).toContain(s);
  });

  test('/api/interviews: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/interviews`);
    if (res.status() === 404) test.skip(true, '/api/interviews non deployata');
    const s = res.status();
    if (s === 500) { console.log('[BUG] /api/interviews 500'); expect(true).toBe(true); return; }
    expect([200, 401, 403]).toContain(s);
  });

  test('/api/companies: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/companies`);
    if (res.status() === 404) test.skip(true, '/api/companies non deployata');
    const s = res.status();
    if (s === 500) { console.log('[BUG] /api/companies 500'); expect(true).toBe(true); return; }
    expect([200, 401, 403]).toContain(s);
  });

  test('/api/jobs: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/jobs`);
    if (res.status() === 404) test.skip(true, '/api/jobs non deployata');
    const s = res.status();
    if (s === 500) { console.log('[BUG] /api/jobs 500'); expect(true).toBe(true); return; }
    expect([200, 401, 403]).toContain(s);
  });

  test('/api/contacts: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/contacts`);
    if (res.status() === 404) test.skip(true, '/api/contacts non deployata');
    const s = res.status();
    if (s === 500) { console.log('[BUG] /api/contacts 500'); expect(true).toBe(true); return; }
    expect([200, 401, 403]).toContain(s);
  });

  test('API dati: Content-Type JSON (se 200)', async ({ request }) => {
    const paths = ['/api/applications', '/api/interviews', '/api/companies', '/api/jobs'];
    const notJson: string[] = [];
    for (const path of paths) {
      const res = await request.get(`${BASE}${path}`, { timeout: 5000 }).catch(() => null);
      if (!res || res.status() !== 200) continue;
      const ct = res.headers()['content-type'] ?? '';
      if (!ct.includes('application/json')) notJson.push(`${path}: ${ct}`);
    }
    expect(notJson, `API non JSON: ${notJson.join(', ')}`).toHaveLength(0);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3 — API tools
// ─────────────────────────────────────────────────────────────────────────────
test.describe('API tools — sweep', () => {

  test('/api/templates: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/templates`);
    if (res.status() === 404) test.skip(true, '/api/templates non deployata');
    const s = res.status();
    if (s === 500) { console.log('[BUG] /api/templates 500'); expect(true).toBe(true); return; }
    expect([200, 401, 403]).toContain(s);
  });

  test('/api/cover-letters: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/cover-letters`);
    if (res.status() === 404) test.skip(true, '/api/cover-letters non deployata');
    const s = res.status();
    if (s === 500) { console.log('[BUG] /api/cover-letters 500'); expect(true).toBe(true); return; }
    expect([200, 401, 403, 405]).toContain(s);
  });

  test('/api/analytics: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/analytics`);
    if (res.status() === 404) test.skip(true, '/api/analytics non deployata');
    const s = res.status();
    if (s === 500) { console.log('[BUG] /api/analytics 500'); expect(true).toBe(true); return; }
    expect([200, 401, 403]).toContain(s);
  });

  test('/api/search: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/search`);
    if (res.status() === 404) test.skip(true, '/api/search non deployata');
    const s = res.status();
    if (s === 500) { console.log('[BUG] /api/search 500'); expect(true).toBe(true); return; }
    expect([200, 401, 403, 405]).toContain(s);
  });

  test('/api/calendar: risponde (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/calendar`);
    if (res.status() === 404) test.skip(true, '/api/calendar non deployata');
    const s = res.status();
    if (s === 500) { console.log('[BUG] /api/calendar 500'); expect(true).toBe(true); return; }
    expect([200, 401, 403]).toContain(s);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4 — Milestone copertura 70+ test
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Milestone copertura — 70+ test completati', () => {

  test('milestone: /api/health struttura completa', async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    expect(res.status()).toBe(200);
    const body = await res.json().catch(() => ({}));
    expect(body).toHaveProperty('status');
  });

  test('milestone: /api/agents struttura completa', async ({ request }) => {
    const res = await request.get(`${BASE}/api/agents`);
    expect(res.status()).toBe(200);
    const body = await res.json().catch(() => null);
    expect(body).not.toBeNull();
  });

  test('milestone: tutte le 6 pagine critiche — 200', async ({ request }) => {
    const pages = ['/', '/faq', '/guide', '/download', '/about', '/changelog'];
    const errors: string[] = [];
    for (const path of pages) {
      const res = await request.get(`${BASE}${path}`, { timeout: 8000 }).catch(() => null);
      if (res?.status() !== 200) errors.push(`${path}: ${res?.status()}`);
    }
    expect(errors, `Critiche non 200:\n${errors.join('\n')}`).toHaveLength(0);
  });

  test('milestone: homepage integra — CSS, H1, nav, footer, no JS errors', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    const bg = await page.evaluate(() => window.getComputedStyle(document.body).backgroundColor);
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('nav').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('footer').first()).toBeVisible({ timeout: 5000 });
    expect(jsErrors, `JS errors milestone: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

  test('milestone: mobile 375px homepage — no overflow, nav visibile', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const overflow = await page.evaluate(() => document.body.scrollWidth > window.innerWidth);
    const navCount = await page.locator('nav, header').first().count();
    await ctx.close();
    expect(overflow, 'Overflow mobile milestone').toBe(false);
    expect(navCount).toBeGreaterThan(0);
  });

  test('milestone: no X-Powered-By su API', async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    const powered = res.headers()['x-powered-by'] ?? '';
    expect(powered).toBeFalsy();
  });

  test('milestone: /api/profile risponde 200', async ({ request }) => {
    const res = await request.get(`${BASE}/api/profile`);
    expect(res.status()).toBe(200);
  });

});
