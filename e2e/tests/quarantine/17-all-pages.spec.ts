import { test, expect } from '@playwright/test';

/**
 * FLUSSO 17 — TEST TUTTE LE PAGINE WEB
 * Verifica che ogni pagina carichi senza errori 4xx/5xx e
 * che la sidebar di navigazione sia presente e funzionante.
 */

const BASE = process.env.BASE_URL || 'https://jobhunterteam.ai';

const PAGES = [
  { path: '/',                  name: 'homepage/overview' },
  { path: '/agents',            name: 'agents list' },
  { path: '/agents/test-1',     name: 'agent detail' },
  { path: '/tasks',             name: 'tasks' },
  { path: '/assistant',         name: 'assistant' },
  { path: '/history',           name: 'history' },
  { path: '/analytics',         name: 'analytics' },
  { path: '/queue',             name: 'queue' },
  { path: '/events',            name: 'events' },
  { path: '/notifications',     name: 'notifications' },
  { path: '/credentials',       name: 'credentials' },
  { path: '/plugins',           name: 'plugins' },
  { path: '/templates',         name: 'templates' },
  { path: '/logs',              name: 'logs' },
  { path: '/deploy',            name: 'deploy' },
  { path: '/providers',         name: 'providers' },
  { path: '/gateway',           name: 'gateway' },
  { path: '/rate-limiter',      name: 'rate-limiter' },
  { path: '/memory',            name: 'memory' },
  { path: '/tools',             name: 'tools' },
  { path: '/daemon',            name: 'daemon' },
  { path: '/config',            name: 'config' },
  { path: '/sessions',          name: 'sessions' },
  { path: '/sessions/test-1',   name: 'session detail' },
  { path: '/settings',          name: 'settings' },
  { path: '/cron',              name: 'cron' },
  { path: '/setup',             name: 'setup wizard' },
];

// API routes da verificare
const API_ROUTES = [
  '/api/agents',
  '/api/cron',
  '/api/settings',
  '/api/telegram',
  '/api/analytics',
  '/api/sessions',
  '/api/tools',
  '/api/plugins',
  '/api/memory',
  '/api/daemon',
  '/api/config',
  '/api/gateway',
  '/api/assistant',
];

test.describe('Tutte le pagine web — caricamento', () => {

  for (const { path, name } of PAGES) {
    test(`${name} (${path}) — non 404/500`, async ({ page }) => {
      const res = await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      const status = res?.status() ?? 0;
      expect(status, `${path} ha restituito ${status}`).not.toBe(500);
      expect(status, `${path} ha restituito 404`).not.toBe(404);
    });
  }

});

test.describe('API routes — rispondono', () => {

  for (const route of API_ROUTES) {
    test(`${route} — risponde (non 500)`, async ({ page }) => {
      const res = await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 10000 });
      const status = res?.status() ?? 0;
      expect(status, `${route} ha restituito 500`).not.toBe(500);
    });
  }

});

test.describe('Sidebar navigazione', () => {

  test('sidebar presente su /agents', async ({ page }) => {
    // La homepage (/) non mostra la sidebar per design — usare una pagina interna
    await page.goto(`${BASE}/agents`, { waitUntil: 'domcontentloaded' });
    const nav = page.locator('aside').or(page.locator('nav')).or(page.locator('[data-testid="sidebar"]'));
    await expect(nav.first()).toBeVisible({ timeout: 10000 });
  });

  test('content guard: nessun termine interno nelle pagine', async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    const body = await page.textContent('body') ?? '';
    const termini = ['worktree', 'tmux', 'JHT-E2E', 'JHT-BACKEND', 'task-oc-'];
    for (const t of termini) {
      expect(body, `termine interno "${t}" visibile`).not.toContain(t);
    }
  });

});
