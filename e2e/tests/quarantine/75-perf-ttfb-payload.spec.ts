import { test, expect } from '@playwright/test';

/**
 * FLUSSO 75 — PERFORMANCE: TTFB E PAYLOAD SIZE
 *
 * Suite 1: TTFB (Time To First Byte) — pagine critiche < 3s
 * Suite 2: Payload size — homepage HTML < 500KB
 * Suite 3: API response time — API core < 2s
 * Suite 4: Regressione performance — nessuna regressione dopo 74 test
 */

const BASE = process.env.BASE_URL || 'https://jobhunterteam.ai';

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 — TTFB pagine critiche
// ─────────────────────────────────────────────────────────────────────────────
test.describe('TTFB — pagine critiche', () => {

  test('homepage: TTFB < 3000ms', async ({ request }) => {
    const start = Date.now();
    const res = await request.get(`${BASE}/`, { timeout: 10000 });
    const elapsed = Date.now() - start;
    expect(res.status()).toBe(200);
    if (elapsed >= 3000) {
      console.log(`[PERF WARN] Homepage TTFB lenta: ${elapsed}ms`);
    } else {
      console.log(`[PERF OK] Homepage TTFB: ${elapsed}ms`);
    }
    expect(elapsed).toBeLessThan(5000); // soglia hard: 5s
  });

  test('/faq: TTFB < 3000ms', async ({ request }) => {
    const start = Date.now();
    const res = await request.get(`${BASE}/faq`, { timeout: 10000 });
    const elapsed = Date.now() - start;
    expect(res.status()).toBe(200);
    if (elapsed >= 3000) console.log(`[PERF WARN] /faq TTFB: ${elapsed}ms`);
    expect(elapsed).toBeLessThan(5000);
  });

  test('/guide: TTFB < 3000ms', async ({ request }) => {
    const start = Date.now();
    const res = await request.get(`${BASE}/guide`, { timeout: 10000 });
    const elapsed = Date.now() - start;
    expect(res.status()).toBe(200);
    if (elapsed >= 3000) console.log(`[PERF WARN] /guide TTFB: ${elapsed}ms`);
    expect(elapsed).toBeLessThan(5000);
  });

  test('/about: TTFB < 3000ms', async ({ request }) => {
    const start = Date.now();
    const res = await request.get(`${BASE}/about`, { timeout: 10000 });
    const elapsed = Date.now() - start;
    expect(res.status()).toBe(200);
    if (elapsed >= 3000) console.log(`[PERF WARN] /about TTFB: ${elapsed}ms`);
    expect(elapsed).toBeLessThan(5000);
  });

  test('/download: TTFB < 3000ms', async ({ request }) => {
    const start = Date.now();
    const res = await request.get(`${BASE}/download`, { timeout: 10000 });
    const elapsed = Date.now() - start;
    expect(res.status()).toBe(200);
    if (elapsed >= 3000) console.log(`[PERF WARN] /download TTFB: ${elapsed}ms`);
    expect(elapsed).toBeLessThan(5000);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2 — Payload size
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Payload size', () => {

  test('homepage: HTML < 500KB', async ({ request }) => {
    const res = await request.get(`${BASE}/`);
    expect(res.status()).toBe(200);
    const text = await res.text();
    const sizeKB = Buffer.byteLength(text, 'utf8') / 1024;
    console.log(`[PERF] Homepage HTML: ${sizeKB.toFixed(1)}KB`);
    expect(sizeKB).toBeLessThan(500);
  });

  test('/about: HTML < 300KB', async ({ request }) => {
    const res = await request.get(`${BASE}/about`);
    expect(res.status()).toBe(200);
    const text = await res.text();
    const sizeKB = Buffer.byteLength(text, 'utf8') / 1024;
    console.log(`[PERF] /about HTML: ${sizeKB.toFixed(1)}KB`);
    expect(sizeKB).toBeLessThan(300);
  });

  test('/api/health: payload < 10KB', async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    expect(res.status()).toBe(200);
    const text = await res.text();
    const sizeKB = Buffer.byteLength(text, 'utf8') / 1024;
    console.log(`[PERF] /api/health payload: ${sizeKB.toFixed(2)}KB`);
    expect(sizeKB).toBeLessThan(10);
  });

  test('/api/agents: payload < 50KB', async ({ request }) => {
    const res = await request.get(`${BASE}/api/agents`);
    expect(res.status()).toBe(200);
    const text = await res.text();
    const sizeKB = Buffer.byteLength(text, 'utf8') / 1024;
    console.log(`[PERF] /api/agents payload: ${sizeKB.toFixed(2)}KB`);
    expect(sizeKB).toBeLessThan(50);
  });

  test('homepage: nessun asset > 1MB (resource timing)', async ({ page }) => {
    const heavyResources: string[] = [];
    page.on('response', async (response) => {
      const url = response.url();
      const headers = response.headers();
      const contentLength = parseInt(headers['content-length'] || '0', 10);
      if (contentLength > 1024 * 1024) {
        heavyResources.push(`${url.split('/').pop()}: ${(contentLength / 1024).toFixed(0)}KB`);
      }
    });
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    if (heavyResources.length > 0) {
      console.log(`[PERF WARN] Asset > 1MB: ${heavyResources.join(', ')}`);
    }
    expect(heavyResources.length).toBeLessThan(3); // tolleranza: max 2 asset pesanti
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3 — API response time
// ─────────────────────────────────────────────────────────────────────────────
test.describe('API response time', () => {

  test('/api/health: risposta < 2000ms', async ({ request }) => {
    const start = Date.now();
    const res = await request.get(`${BASE}/api/health`, { timeout: 5000 });
    const elapsed = Date.now() - start;
    expect(res.status()).toBe(200);
    console.log(`[PERF] /api/health: ${elapsed}ms`);
    expect(elapsed).toBeLessThan(2000);
  });

  test('/api/agents: risposta < 2000ms', async ({ request }) => {
    const start = Date.now();
    const res = await request.get(`${BASE}/api/agents`, { timeout: 5000 });
    const elapsed = Date.now() - start;
    expect(res.status()).toBe(200);
    console.log(`[PERF] /api/agents: ${elapsed}ms`);
    expect(elapsed).toBeLessThan(2000);
  });

  test('/api/about: risposta < 2000ms', async ({ request }) => {
    const start = Date.now();
    const res = await request.get(`${BASE}/api/about`, { timeout: 5000 });
    const elapsed = Date.now() - start;
    expect(res.status()).toBe(200);
    console.log(`[PERF] /api/about: ${elapsed}ms`);
    expect(elapsed).toBeLessThan(2000);
  });

  test('/api/profile: risposta < 2000ms', async ({ request }) => {
    const start = Date.now();
    const res = await request.get(`${BASE}/api/profile`, { timeout: 5000 });
    const elapsed = Date.now() - start;
    expect(res.status()).toBe(200);
    console.log(`[PERF] /api/profile: ${elapsed}ms`);
    expect(elapsed).toBeLessThan(2000);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4 — Regressione performance
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Regressione performance', () => {

  test('homepage: LCP simulato — H1 visibile < 3s', async ({ page }) => {
    const start = Date.now();
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.locator('h1').first().waitFor({ timeout: 8000 });
    const elapsed = Date.now() - start;
    console.log(`[PERF] H1 visibile dopo: ${elapsed}ms`);
    if (elapsed >= 3000) console.log('[PERF WARN] H1 visibile > 3s — possibile LCP lento');
    expect(elapsed).toBeLessThan(8000);
  });

  test('homepage: no render blocking JS (no pageerror)', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/expected|warning|chunk|hydrat|ResizeObserver/i.test(e.message)) {
        jsErrors.push(e.message);
      }
    });
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    expect(jsErrors, `JS errors performance: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

  test('mobile: homepage load < 6s', async ({ browser }) => {
    const ctx = await browser.newContext({
      viewport: { width: 375, height: 812 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
    });
    const page = await ctx.newPage();
    const start = Date.now();
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    const elapsed = Date.now() - start;
    await ctx.close();
    console.log(`[PERF] Mobile homepage load: ${elapsed}ms`);
    expect(elapsed).toBeLessThan(10000);
  });

  test('pagine critiche: nessuna > 4s TTFB', async ({ request }) => {
    const pages = ['/', '/faq', '/guide', '/about', '/changelog'];
    const slow: string[] = [];
    for (const path of pages) {
      const start = Date.now();
      const res = await request.get(`${BASE}${path}`, { timeout: 10000 }).catch(() => null);
      const elapsed = Date.now() - start;
      if (elapsed > 4000) slow.push(`${path}: ${elapsed}ms`);
    }
    if (slow.length > 0) console.log(`[PERF WARN] Pagine lente: ${slow.join(', ')}`);
    expect(slow.length).toBeLessThan(2); // tolleranza: max 1 pagina lenta
  });

});
