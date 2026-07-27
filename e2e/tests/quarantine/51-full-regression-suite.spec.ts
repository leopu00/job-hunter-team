import { test, expect } from '@playwright/test';

/**
 * FLUSSO 51 — FULL REGRESSION SUITE
 *
 * Suite di regressione definitiva — verifica completa del sito in una run.
 * Eseguibile in < 90s. Ogni test deve passare su produzione.
 *
 * Suite 1: Pagine pubbliche — tutte le 12 pagine
 * Suite 2: API complete — health, about, agents, profile, changelog, stats, reports
 * Suite 3: Security essenziale — no dati sensibili, no X-Powered-By, HTTPS
 * Suite 4: Performance — TTFB e tempi risposta
 * Suite 5: Visual integrity — H1, footer, nav su pagine chiave
 */

const BASE = process.env.BASE_URL || 'https://jobhunterteam.ai';

const ALL_PUBLIC_PAGES = [
  { path: '/',          label: 'Homepage',  critical: true  },
  { path: '/faq',       label: 'FAQ',       critical: true  },
  { path: '/guide',     label: 'Guida',     critical: true  },
  { path: '/download',  label: 'Download',  critical: true  },
  { path: '/about',     label: 'About',     critical: true  },
  { path: '/changelog', label: 'Changelog', critical: true  },
  { path: '/docs',      label: 'Docs',      critical: false },
  { path: '/pricing',   label: 'Pricing',   critical: false },
  { path: '/privacy',   label: 'Privacy',   critical: false },
  { path: '/demo',      label: 'Demo',      critical: false },
  { path: '/stats',     label: 'Stats',     critical: false },
  { path: '/reports',   label: 'Reports',   critical: false },
];

const ALL_APIS = [
  { path: '/api/health',          label: 'Health',   mustHave200: true  },
  { path: '/api/about',           label: 'About',    mustHave200: true  },
  { path: '/api/agents',          label: 'Agents',   mustHave200: true  },
  { path: '/api/profile',         label: 'Profile',  mustHave200: true  },
  { path: '/api/changelog',       label: 'Changelog',mustHave200: false },
  { path: '/api/stats',           label: 'Stats',    mustHave200: false },
  { path: '/api/reports',         label: 'Reports',  mustHave200: false },
  { path: '/api/profile/export',  label: 'Export',   mustHave200: false },
  { path: '/api/profile/avatar',  label: 'Avatar',   mustHave200: false },
];

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 — Pagine pubbliche
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Regressione — pagine pubbliche', () => {

  test('pagine critiche: tutte rispondono 200', async ({ request }) => {
    const errors: string[] = [];
    for (const { path, label, critical } of ALL_PUBLIC_PAGES) {
      if (!critical) continue;
      const res = await request.get(`${BASE}${path}`, { timeout: 10000 }).catch(() => null);
      if (!res) { errors.push(`TIMEOUT ${label}`); continue; }
      if (res.status() !== 200) errors.push(`${res.status()} ${label}`);
    }
    expect(errors, `Pagine critiche con errori:\n${errors.join('\n')}`).toHaveLength(0);
  });

  test('pagine opzionali: nessuna risponde 500', async ({ request }) => {
    const errors: string[] = [];
    for (const { path, label, critical } of ALL_PUBLIC_PAGES) {
      if (critical) continue;
      const res = await request.get(`${BASE}${path}`, { timeout: 10000 }).catch(() => null);
      if (res?.status() === 500) errors.push(`500 ${label}`);
    }
    expect(errors, `Pagine opzionali con 500:\n${errors.join('\n')}`).toHaveLength(0);
  });

  test('homepage: H1, title, nav, footer intatti', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const title = await page.title();
    expect(title.trim().length).toBeGreaterThan(5);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('nav').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('footer').first()).toBeVisible({ timeout: 5000 });
  });

  test('pagine critiche: H1 visibile', async ({ page }) => {
    const missing: string[] = [];
    for (const { path, label, critical } of ALL_PUBLIC_PAGES) {
      if (!critical) continue;
      const res = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
      if (res?.status() !== 200) continue;
      const h1Count = await page.locator('h1').count();
      if (h1Count === 0) missing.push(label);
    }
    expect(missing, `Pagine senza H1: ${missing.join(', ')}`).toHaveLength(0);
  });

  test('nessuna pagina pubblica: link rotti verso homepage', async ({ page, request }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const links: string[] = await page.evaluate((base) =>
      [...document.querySelectorAll('a[href]')]
        .map((a) => (a as HTMLAnchorElement).href)
        .filter((h) => h.startsWith(base) && !h.includes('#'))
        .filter((h, i, arr) => arr.indexOf(h) === i)
        .slice(0, 15)
    , BASE);
    const broken: string[] = [];
    for (const url of links) {
      const res = await request.get(url, { timeout: 8000 }).catch(() => null);
      if (res?.status() === 500) broken.push(`500 — ${url}`);
    }
    expect(broken, `Link con 500:\n${broken.join('\n')}`).toHaveLength(0);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2 — API complete
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Regressione — API complete', () => {

  test('API con 200 obbligatorio: tutte OK', async ({ request }) => {
    const errors: string[] = [];
    for (const { path, label, mustHave200 } of ALL_APIS) {
      if (!mustHave200) continue;
      const res = await request.get(`${BASE}${path}`, { timeout: 8000 }).catch(() => null);
      if (!res) { errors.push(`TIMEOUT ${label}`); continue; }
      if (res.status() !== 200) errors.push(`${res.status()} ${label}`);
    }
    expect(errors, `API obbligatorie con errori:\n${errors.join('\n')}`).toHaveLength(0);
  });

  test('API opzionali: nessuna risponde 500', async ({ request }) => {
    const errors: string[] = [];
    for (const { path, label, mustHave200 } of ALL_APIS) {
      if (mustHave200) continue;
      const res = await request.get(`${BASE}${path}`, { timeout: 8000 }).catch(() => null);
      if (res?.status() === 500) errors.push(`500 ${label}`);
    }
    expect(errors, `API opzionali con 500:\n${errors.join('\n')}`).toHaveLength(0);
  });

  test('/api/health: struttura completa (status + uptime)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    expect(res.status()).toBe(200);
    const body = await res.json().catch(() => ({}));
    expect(body).toHaveProperty('status');
    const hasUptime = 'uptime' in body || 'startedAt' in body || 'started_at' in body;
    expect(hasUptime).toBe(true);
  });

  test('/api/agents: lista con almeno un campo id/name', async ({ request }) => {
    const res = await request.get(`${BASE}/api/agents`);
    expect(res.status()).toBe(200);
    const body = await res.json().catch(() => null);
    expect(body).not.toBeNull();
    const agents = Array.isArray(body) ? body : (body?.agents ?? body?.data ?? []);
    if (agents.length > 0) {
      const first = agents[0];
      expect('id' in first || 'name' in first || 'session' in first).toBe(true);
    }
  });

  test('API: Content-Type JSON su tutte le API 200', async ({ request }) => {
    const notJson: string[] = [];
    for (const { path, label } of ALL_APIS) {
      const res = await request.get(`${BASE}${path}`, { timeout: 5000 }).catch(() => null);
      if (!res || res.status() !== 200) continue;
      const ct = res.headers()['content-type'] ?? '';
      if (!ct.includes('application/json')) notJson.push(`${label}: ${ct}`);
    }
    expect(notJson, `API non JSON: ${notJson.join(', ')}`).toHaveLength(0);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3 — Security
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Regressione — security essenziale', () => {

  test('no X-Powered-By su /api/health', async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    const powered = res.headers()['x-powered-by'] ?? '';
    expect(powered).toBeFalsy();
  });

  test('no chiavi API nel body /api/health', async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    const text = await res.text();
    expect(text).not.toMatch(/sk-ant-|sk-[a-zA-Z0-9]{10}/i);
    expect(text).not.toMatch(/api[_-]?key\s*[:=]/i);
  });

  test('no path assoluti in /api/about', async ({ request }) => {
    const res = await request.get(`${BASE}/api/about`);
    const text = await res.text();
    expect(text).not.toMatch(/\/home\/\w+\/|\/Users\/\w+\//);
  });

  test('BASE_URL usa HTTPS', () => {
    expect(BASE).toMatch(/^https:/i);
  });

  test('404 non espone stack trace', async ({ page }) => {
    await page.goto(`${BASE}/questa-pagina-non-esiste-xyz`, { waitUntil: 'networkidle' });
    const content = await page.locator('body').innerText().catch(() => '');
    expect(content).not.toMatch(/\bat\s+\w+\s+\(/);
    expect(content).not.toMatch(/Error:\s+.*\n\s+at/m);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4 — Performance
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Regressione — performance TTFB', () => {

  test('API core: rispondono tutte < 3s', async ({ request }) => {
    const slow: string[] = [];
    for (const { path, label, mustHave200 } of ALL_APIS.filter((a) => a.mustHave200)) {
      const start = Date.now();
      const res = await request.get(`${BASE}${path}`, { timeout: 5000 }).catch(() => null);
      const elapsed = Date.now() - start;
      if (res?.status() === 200 && elapsed > 3000) slow.push(`${label}: ${elapsed}ms`);
    }
    if (slow.length > 0) console.log(`[WARN] API lente: ${slow.join(', ')}`);
    expect(slow.length).toBeLessThan(2);
  });

  test('pagine critiche: TTFB < 4s', async ({ request }) => {
    const slow: string[] = [];
    for (const { path, label, critical } of ALL_PUBLIC_PAGES) {
      if (!critical) continue;
      const start = Date.now();
      await request.get(`${BASE}${path}`, { timeout: 6000 }).catch(() => null);
      const elapsed = Date.now() - start;
      if (elapsed > 4000) slow.push(`${label}: ${elapsed}ms`);
    }
    if (slow.length > 0) console.log(`[WARN] Pagine lente: ${slow.join(', ')}`);
    expect(slow.length).toBeLessThan(2);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 5 — Visual integrity
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Regressione — visual integrity', () => {

  test('homepage: CSS background definito (non trasparente)', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const bg = await page.evaluate(() => window.getComputedStyle(document.body).backgroundColor);
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
    expect(bg).not.toBe('');
  });

  test('homepage: nessun errore JS critico', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    expect(jsErrors, `Errori JS: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

  test('homepage mobile (375px): no overflow', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const overflow = await page.evaluate(() => document.body.scrollWidth > window.innerWidth);
    await ctx.close();
    expect(overflow, 'Overflow mobile homepage').toBe(false);
  });

  test('/faq: no overflow mobile', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();
    const res = await page.goto(`${BASE}/faq`, { waitUntil: 'networkidle' });
    if (!res || res.status() !== 200) { await ctx.close(); test.skip(true, '/faq non disponibile'); }
    const overflow = await page.evaluate(() => document.body.scrollWidth > window.innerWidth);
    await ctx.close();
    expect(overflow, 'Overflow mobile /faq').toBe(false);
  });

  test('homepage dark mode: H1 visibile', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const h1 = page.locator('h1').first();
    await expect(h1).toBeVisible({ timeout: 5000 });
    const color = await h1.evaluate((el) => window.getComputedStyle(el).color);
    expect(color).not.toBe('rgba(0, 0, 0, 0)');
  });

});
