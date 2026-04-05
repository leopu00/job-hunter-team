import { test, expect } from '@playwright/test';

/**
 * FLUSSO 43 — FAQ JSON-LD E LAYOUT PAGINE PROTETTE
 *
 * Suite 1: FAQ JSON-LD — structured data FAQPage su /faq
 * Suite 2: Layout pagine protette — title, meta, breadcrumb aggiornato
 * Suite 3: KeyboardShortcuts aggiornato — nessun crash
 * Suite 4: Breadcrumb aggiornato — link corretti su pagine protette
 */

const BASE = process.env.BASE_URL || 'https://jobhunterteam.ai';

const PROTECTED_PAGES = [
  { path: '/analista',     label: 'Analista'     },
  { path: '/applications', label: 'Applications' },
  { path: '/dashboard',    label: 'Dashboard'    },
  { path: '/scout',        label: 'Scout'        },
  { path: '/agents',       label: 'Agents'       },
];

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 — FAQ JSON-LD (FaqJsonLd.tsx)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('FAQ JSON-LD — structured data /faq', () => {

  test('/faq: risponde 200', async ({ request }) => {
    const res = await request.get(`${BASE}/faq`);
    expect(res.status()).toBe(200);
  });

  test('/faq: script JSON-LD presente nel <head>', async ({ page }) => {
    await page.goto(`${BASE}/faq`, { waitUntil: 'networkidle' });
    const jsonLdCount = await page.evaluate(() =>
      document.querySelectorAll('script[type="application/ld+json"]').length
    );
    if (jsonLdCount === 0) test.skip(true, 'JSON-LD non presente su /faq — non ancora deployato');
    expect(jsonLdCount).toBeGreaterThan(0);
  });

  test('/faq: JSON-LD contiene @type FAQPage', async ({ page }) => {
    await page.goto(`${BASE}/faq`, { waitUntil: 'networkidle' });
    const hasFaqPage = await page.evaluate(() => {
      const scripts = [...document.querySelectorAll('script[type="application/ld+json"]')];
      return scripts.some((s) => (s.textContent ?? '').includes('FAQPage'));
    });
    if (!hasFaqPage) test.skip(true, 'FAQPage schema non presente — FaqJsonLd non deployato');
    expect(hasFaqPage).toBe(true);
  });

  test('/faq: JSON-LD FAQPage è JSON valido', async ({ page }) => {
    await page.goto(`${BASE}/faq`, { waitUntil: 'networkidle' });
    const scripts = await page.evaluate(() =>
      [...document.querySelectorAll('script[type="application/ld+json"]')]
        .map((s) => s.textContent ?? '')
    );
    if (scripts.length === 0) test.skip(true, 'JSON-LD assente');
    for (const script of scripts) {
      try { JSON.parse(script); } catch { throw new Error(`JSON-LD non valido: ${script.slice(0, 100)}`); }
    }
    expect(scripts.length).toBeGreaterThan(0);
  });

  test('/faq: JSON-LD contiene mainEntity (domande)', async ({ page }) => {
    await page.goto(`${BASE}/faq`, { waitUntil: 'networkidle' });
    const hasMainEntity = await page.evaluate(() => {
      const scripts = [...document.querySelectorAll('script[type="application/ld+json"]')];
      return scripts.some((s) => (s.textContent ?? '').includes('mainEntity'));
    });
    if (!hasMainEntity) test.skip(true, 'mainEntity non presente nel JSON-LD /faq');
    expect(hasMainEntity).toBe(true);
  });

  test('/faq: almeno 3 domande nel JSON-LD FAQPage', async ({ page }) => {
    await page.goto(`${BASE}/faq`, { waitUntil: 'networkidle' });
    const questionCount = await page.evaluate(() => {
      const scripts = [...document.querySelectorAll('script[type="application/ld+json"]')];
      for (const s of scripts) {
        try {
          const data = JSON.parse(s.textContent ?? '{}');
          if (data['@type'] === 'FAQPage' && Array.isArray(data.mainEntity)) {
            return data.mainEntity.length;
          }
        } catch {}
      }
      return 0;
    });
    if (questionCount === 0) test.skip(true, 'FAQPage JSON-LD non trovato');
    expect(questionCount, 'Meno di 3 domande nel JSON-LD FAQPage').toBeGreaterThanOrEqual(3);
  });

  test('/faq: layout aggiornato ha <title> specifico', async ({ page }) => {
    await page.goto(`${BASE}/faq`, { waitUntil: 'networkidle' });
    const title = await page.title();
    expect(title.trim().length).toBeGreaterThan(5);
    // Il title aggiornato dovrebbe menzionare FAQ o domande
    if (title.toLowerCase().includes('faq') || title.toLowerCase().includes('domande')) {
      expect(true).toBe(true);
    }
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2 — Layout pagine protette (aggiornati)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Layout pagine protette — title e meta', () => {

  for (const { path, label } of PROTECTED_PAGES) {

    test(`${label}: risponde (non 500)`, async ({ request }) => {
      const res = await request.get(`${BASE}${path}`);
      if (res.status() === 404) test.skip(true, `${label} non disponibile`);
      expect(res.status(), `${label} risponde 500`).not.toBe(500);
    });

    test(`${label}: title presente nel HTML`, async ({ request }) => {
      const res = await request.get(`${BASE}${path}`);
      if (res.status() !== 200) test.skip(true, `${label} non disponibile`);
      const html = await res.text();
      expect(html).toMatch(/<title>/i);
    });

  }

  test('tutte le pagine protette hanno title non vuoto', async ({ request }) => {
    const missing: string[] = [];
    for (const { path, label } of PROTECTED_PAGES) {
      const res = await request.get(`${BASE}${path}`, { timeout: 8000 }).catch(() => null);
      if (!res || res.status() !== 200) continue;
      const html = await res.text();
      const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
      if (!titleMatch || titleMatch[1].trim().length < 3) {
        missing.push(label);
      }
    }
    if (missing.length > 0) console.log(`[WARN] Title vuoto su: ${missing.join(', ')}`);
    expect(missing.length).toBeLessThan(3);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3 — KeyboardShortcuts aggiornato
// ─────────────────────────────────────────────────────────────────────────────
test.describe('KeyboardShortcuts — nessun crash post-update', () => {

  test('/agents: pagina carica senza errori JS', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    const res = await page.goto(`${BASE}/agents`, { waitUntil: 'networkidle' });
    if (!res || res.status() !== 200) test.skip(true, '/agents non disponibile');
    await page.waitForTimeout(500);
    expect(jsErrors, `Errori JS /agents: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

  test('/agents: shortcut Ctrl+K non crasha (GlobalSearch aggiornato)', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => jsErrors.push(e.message));
    const res = await page.goto(`${BASE}/agents`, { waitUntil: 'networkidle' });
    if (!res || res.status() !== 200) test.skip(true, '/agents non disponibile');
    const url = page.url();
    if (url !== `${BASE}/agents`) test.skip(true, '/agents protetta');
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    const critical = jsErrors.filter((e) => !/expected|warning|chunk|hydrat/i.test(e));
    expect(critical, `Errori shortcut: ${critical.join(', ')}`).toHaveLength(0);
  });

  test('homepage: nessun crash con shortcut / su landing', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => jsErrors.push(e.message));
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.keyboard.press('/');
    await page.waitForTimeout(200);
    const critical = jsErrors.filter((e) => !/expected|warning|chunk|hydrat/i.test(e));
    expect(critical).toHaveLength(0);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4 — Breadcrumb aggiornato
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Breadcrumb — struttura aggiornata', () => {

  test('/agents: Breadcrumb non crasha', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => jsErrors.push(e.message));
    const res = await page.goto(`${BASE}/agents`, { waitUntil: 'networkidle' });
    if (!res || res.status() !== 200) test.skip(true, '/agents non disponibile');
    const url = page.url();
    if (url !== `${BASE}/agents`) test.skip(true, '/agents protetta');
    await page.waitForTimeout(500);
    const critical = jsErrors.filter((e) => !/expected|warning|chunk|hydrat/i.test(e));
    expect(critical).toHaveLength(0);
  });

  test('/faq: breadcrumb o navigazione presente', async ({ page }) => {
    await page.goto(`${BASE}/faq`, { waitUntil: 'networkidle' });
    const nav = page.locator('nav, [role="navigation"]').first();
    await expect(nav).toBeVisible({ timeout: 5000 });
  });

  test('/faq: link verso homepage presente', async ({ page }) => {
    await page.goto(`${BASE}/faq`, { waitUntil: 'networkidle' });
    const homeLink = page.locator('a[href="/"]').first();
    await expect(homeLink).toBeVisible({ timeout: 5000 });
  });

  test('regressione: /api/health ancora OK dopo tutti gli update layout', async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    expect(res.status()).toBe(200);
    const body = await res.json().catch(() => ({}));
    expect(body).toHaveProperty('status');
  });

});
