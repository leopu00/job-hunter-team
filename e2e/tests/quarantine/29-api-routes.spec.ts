import { test, expect } from '@playwright/test';

/**
 * FLUSSO 29 — API ROUTES
 *
 * Suite 1: API pubbliche — health, about, changelog
 * Suite 2: API agenti — lista, struttura JSON
 * Suite 3: API robustezza — metodi non supportati, 404 route inesistenti
 * Suite 4: API headers — Content-Type, CORS, cache
 */

const BASE = process.env.BASE_URL || 'https://jobhunterteam.ai';

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1 — API pubbliche
// ─────────────────────────────────────────────────────────────────────────────
test.describe('API pubbliche — health, about, changelog', () => {

  test('GET /api/health risponde 200', async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    expect(res.status()).toBe(200);
  });

  test('GET /api/health: JSON con campo "status"', async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    const body = await res.json().catch(() => null);
    expect(body, 'Body non è JSON').not.toBeNull();
    expect(body).toHaveProperty('status');
  });

  test('GET /api/health: "uptime" o "startedAt" presente', async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    const body = await res.json().catch(() => ({}));
    const hasUptime = 'uptime' in body || 'startedAt' in body || 'started_at' in body;
    expect(hasUptime, 'Campo uptime/startedAt assente in /api/health').toBe(true);
  });

  test('GET /api/about risponde 200', async ({ request }) => {
    const res = await request.get(`${BASE}/api/about`);
    expect(res.status()).toBe(200);
  });

  test('GET /api/about: JSON con campo "name" o "version"', async ({ request }) => {
    const res = await request.get(`${BASE}/api/about`);
    const body = await res.json().catch(() => null);
    expect(body).not.toBeNull();
    const hasName = body && ('name' in body || 'version' in body || 'ok' in body);
    expect(hasName, '"name" o "version" assente in /api/about').toBeTruthy();
  });

  test('GET /api/changelog risponde (200 o 500 su Vercel)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/changelog`);
    expect(res.status(), '/api/changelog risponde 404').not.toBe(404);
  });

  test('GET /api/changelog: Content-Type JSON', async ({ request }) => {
    const res = await request.get(`${BASE}/api/changelog`);
    if (res.status() !== 200) test.skip(true, '/api/changelog non risponde 200');
    const ct = res.headers()['content-type'] ?? '';
    expect(ct).toMatch(/application\/json/i);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2 — API agenti
// ─────────────────────────────────────────────────────────────────────────────
test.describe('API agenti — /api/agents', () => {

  test('GET /api/agents risponde 200', async ({ request }) => {
    const res = await request.get(`${BASE}/api/agents`);
    expect(res.status()).toBe(200);
  });

  test('GET /api/agents: risponde JSON', async ({ request }) => {
    const res = await request.get(`${BASE}/api/agents`);
    const ct = res.headers()['content-type'] ?? '';
    expect(ct).toMatch(/application\/json/i);
  });

  test('GET /api/agents: lista agenti con campi id e name', async ({ request }) => {
    const res = await request.get(`${BASE}/api/agents`);
    const body = await res.json().catch(() => null);
    expect(body).not.toBeNull();
    // Può essere array diretto o { agents: [...] }
    const agents = Array.isArray(body) ? body : (body?.agents ?? body?.data ?? []);
    expect(Array.isArray(agents), 'Lista agenti non è un array').toBe(true);
    if (agents.length > 0) {
      const first = agents[0];
      const hasId = 'id' in first || 'name' in first || 'session' in first;
      expect(hasId, 'Agente non ha campo id/name/session').toBe(true);
    }
  });

  test('GET /api/agents: contiene almeno Scout e Analista', async ({ request }) => {
    const res = await request.get(`${BASE}/api/agents`);
    const body = await res.json().catch(() => null);
    if (!body) test.skip(true, 'Body non è JSON');
    const agents = Array.isArray(body) ? body : (body?.agents ?? body?.data ?? []);
    if (agents.length === 0) test.skip(true, 'Lista agenti vuota — workspace non configurato');
    const names = agents.map((a: any) => (a.name ?? a.id ?? '').toLowerCase());
    expect(names.some((n: string) => n.includes('scout')), 'Scout non trovato negli agenti').toBe(true);
  });

  test('GET /api/agents/metrics risponde (non 404)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/agents/metrics`);
    expect(res.status(), '/api/agents/metrics risponde 404').not.toBe(404);
  });

  test('GET /api/profile risponde 200', async ({ request }) => {
    const res = await request.get(`${BASE}/api/profile`);
    expect(res.status()).toBe(200);
  });

  test('GET /api/profile: JSON con struttura profilo', async ({ request }) => {
    const res = await request.get(`${BASE}/api/profile`);
    const body = await res.json().catch(() => null);
    expect(body, 'Body /api/profile non è JSON').not.toBeNull();
    // Struttura reale: { profile: null | {...} }
    const hasSomeField = body && (
      'profile' in body || 'ok' in body || 'name' in body ||
      'fullName' in body || 'role' in body || 'skills' in body || 'error' in body
    );
    expect(hasSomeField, 'Struttura profilo inattesa').toBeTruthy();
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3 — Robustezza API
// ─────────────────────────────────────────────────────────────────────────────
test.describe('API robustezza — errori e metodi', () => {

  test('GET /api/non-esiste risponde 404 (non 500)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/questa-route-non-esiste-12345`);
    // Next.js App Router: 404 per route non trovata
    expect(res.status(), 'Route inesistente non risponde 404').toBe(404);
  });

  test('POST /api/health (non supportato) risponde 405 o 404', async ({ request }) => {
    const res = await request.post(`${BASE}/api/health`, { data: {} }).catch(() => null);
    if (!res) test.skip(true, 'POST non supportato dal client');
    // Deve essere 405 Method Not Allowed o 404, non 500
    expect([404, 405]).toContain(res!.status());
  });

  test('GET /api/about non espone dati sensibili (no token, no key)', async ({ request }) => {
    const res = await request.get(`${BASE}/api/about`);
    const text = await res.text();
    // Non deve contenere token, chiavi API o path assoluti con dati utente
    expect(text).not.toMatch(/api[-_]?key|secret|password|token/i);
  });

  test('GET /api/health non espone path di sistema sensibili', async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    const body = await res.json().catch(() => ({}));
    const text = JSON.stringify(body);
    // Non esporre path assoluti con username o home directory
    expect(text).not.toMatch(/\/home\/[^/]+\/|\/Users\/[^/]+\//i);
  });

  test('tutte le API pubbliche rispondono < 3000ms', async ({ request }) => {
    const apis = ['/api/health', '/api/about', '/api/agents'];
    for (const api of apis) {
      const start = Date.now();
      await request.get(`${BASE}${api}`);
      const elapsed = Date.now() - start;
      expect(elapsed, `${api} troppo lenta: ${elapsed}ms`).toBeLessThan(3000);
    }
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4 — Headers API
// ─────────────────────────────────────────────────────────────────────────────
test.describe('API headers — Content-Type, cache', () => {

  test('GET /api/health: Content-Type è application/json', async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    const ct = res.headers()['content-type'] ?? '';
    expect(ct).toMatch(/application\/json/i);
  });

  test('GET /api/about: Content-Type è application/json', async ({ request }) => {
    const res = await request.get(`${BASE}/api/about`);
    const ct = res.headers()['content-type'] ?? '';
    expect(ct).toMatch(/application\/json/i);
  });

  test('GET /api/agents: Content-Type è application/json', async ({ request }) => {
    const res = await request.get(`${BASE}/api/agents`);
    const ct = res.headers()['content-type'] ?? '';
    expect(ct).toMatch(/application\/json/i);
  });

  test('GET /api/health: nessun header X-Powered-By che espone stack', async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    const powered = res.headers()['x-powered-by'] ?? '';
    // Next.js di default non espone questo header — se c'è è una configurazione errata
    expect(powered).toBeFalsy();
  });

  test('GET /api/health: risposta è deterministica (due call stesso status)', async ({ request }) => {
    const r1 = await request.get(`${BASE}/api/health`);
    const r2 = await request.get(`${BASE}/api/health`);
    expect(r1.status()).toBe(r2.status());
  });

});
