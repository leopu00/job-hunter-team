import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('node:child_process', () => ({ execSync: vi.fn() }));

import { execSync } from 'node:child_process';
import { checkAll } from '../../../shared/deploy/health-check.js';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mockFetch);
  vi.mocked(execSync).mockReturnValue('JHT-BOT\nJHT-GATEKEEPER\n' as any);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// Helper: fetch risponde con status code
function fetchOk(status = 200) {
  return mockFetch.mockResolvedValue({ status });
}

// --- checkAll struttura report ---

describe('checkAll — struttura report', () => {
  it('ritorna report con ok, ts, durationMs, services', async () => {
    fetchOk(200);
    const r = await checkAll({ timeoutMs: 100 });
    expect(r).toHaveProperty('ok');
    expect(r).toHaveProperty('ts');
    expect(r).toHaveProperty('durationMs');
    expect(r.services).toHaveLength(3);
  });

  it('services include web, gateway, telegram', async () => {
    fetchOk(200);
    const r = await checkAll({ timeoutMs: 100 });
    const names = r.services.map((s) => s.name);
    expect(names).toContain('web');
    expect(names).toContain('gateway');
    expect(names).toContain('telegram');
  });
});

// --- checkAll HTTP ---

describe('checkAll — HTTP checks', () => {
  it('report.ok = true quando tutti i servizi rispondono 200', async () => {
    fetchOk(200);
    const r = await checkAll({ timeoutMs: 100 });
    const web = r.services.find((s) => s.name === 'web')!;
    const gw = r.services.find((s) => s.name === 'gateway')!;
    expect(web.ok).toBe(true);
    expect(web.status).toBe('ok');
    expect(gw.ok).toBe(true);
  });

  it('status = error quando HTTP restituisce 500', async () => {
    mockFetch.mockResolvedValue({ status: 500 });
    const r = await checkAll({ timeoutMs: 100 });
    const web = r.services.find((s) => s.name === 'web')!;
    expect(web.ok).toBe(false);
    expect(web.status).toBe('error');
    expect(web.httpStatus).toBe(500);
  });

  it('404 è considerato ok (< 500)', async () => {
    mockFetch.mockResolvedValue({ status: 404 });
    const r = await checkAll({ timeoutMs: 100 });
    const web = r.services.find((s) => s.name === 'web')!;
    expect(web.ok).toBe(true);
  });

  it('status = timeout su AbortError', async () => {
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    mockFetch.mockRejectedValue(abortErr);
    const r = await checkAll({ timeoutMs: 100 });
    const web = r.services.find((s) => s.name === 'web')!;
    expect(web.ok).toBe(false);
    expect(web.status).toBe('timeout');
  });

  it('status = error su errore di rete generico', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    const r = await checkAll({ timeoutMs: 100 });
    const web = r.services.find((s) => s.name === 'web')!;
    expect(web.ok).toBe(false);
    expect(web.status).toBe('error');
    expect(web.error).toMatch(/ECONNREFUSED/);
  });

  it('usa JHT_WEB_URL da env se presente', async () => {
    fetchOk(200);
    process.env.JHT_WEB_URL = 'http://custom-web:4000';
    await checkAll({ timeoutMs: 100 });
    expect(mockFetch).toHaveBeenCalledWith(
      'http://custom-web:4000',
      expect.any(Object),
    );
    delete process.env.JHT_WEB_URL;
  });
});

// --- checkAll Telegram ---

describe('checkAll — Telegram check', () => {
  it('telegram ok se sessione JHT-BOT trovata in tmux', async () => {
    fetchOk(200);
    vi.mocked(execSync).mockReturnValue('JHT-BOT\nJHT-GATEKEEPER\n' as any);
    const r = await checkAll({ timeoutMs: 100 });
    const tg = r.services.find((s) => s.name === 'telegram')!;
    expect(tg.ok).toBe(true);
  });

  it('telegram error se nessuna sessione tmux Telegram', async () => {
    fetchOk(200);
    vi.mocked(execSync).mockReturnValue('JHT-GATEKEEPER\nJHT-QA\n' as any);
    const r = await checkAll({ timeoutMs: 100 });
    const tg = r.services.find((s) => s.name === 'telegram')!;
    expect(tg.ok).toBe(false);
    expect(tg.error).toBeDefined();
  });

  it('report.ok = false se almeno un servizio è down', async () => {
    fetchOk(200);
    vi.mocked(execSync).mockReturnValue('JHT-QA\n' as any);
    const r = await checkAll({ timeoutMs: 100 });
    expect(r.ok).toBe(false);
  });
});
