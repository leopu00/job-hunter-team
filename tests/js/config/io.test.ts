import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('node:fs');

import * as fs from 'node:fs';
import { readConfig, writeConfig, configExists, redactConfig } from '../../../shared/config/io';

const validConfig = {
  version: 1,
  active_provider: 'claude' as const,
  providers: {
    claude: { name: 'claude' as const, auth_method: 'api_key' as const, api_key: 'sk-ant-key123' },
  },
  channels: {},
  workspace: '/tmp/test-jht',
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- readConfig ---

describe('readConfig', () => {
  it('ritorna errore se file non esiste', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const r = readConfig();
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/non trovato/);
  });

  it('ritorna errore se readFileSync lancia eccezione', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });
    const r = readConfig();
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Errore lettura/);
  });

  it('ritorna errore per JSON non valido', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('{ not valid json }');
    const r = readConfig();
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/JSON non valido/);
  });

  it('ritorna errore se config non passa validazione Zod', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ active_provider: 'unknown' }));
    const r = readConfig();
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Validazione fallita/);
  });

  it('ritorna config valida parsata correttamente', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(validConfig));
    const r = readConfig();
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.active_provider).toBe('claude');
      expect(r.data.version).toBe(1);
      expect(r.data.workspace).toBe('/tmp/test-jht');
    }
  });
});

// --- writeConfig ---

describe('writeConfig', () => {
  it('ritorna errore per config non valida', () => {
    const r = writeConfig({ active_provider: 'invalid_provider' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Validazione fallita/);
  });

  it('crea directory e scrive file per config valida', () => {
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    const r = writeConfig(validConfig);
    expect(r.success).toBe(true);
    expect(fs.mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining('.jht'),
      { recursive: true },
    );
    expect(fs.writeFileSync).toHaveBeenCalled();
  });

  it('ritorna errore se writeFileSync lancia eccezione', () => {
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
    vi.mocked(fs.writeFileSync).mockImplementation(() => {
      throw new Error('ENOSPC: no space left');
    });
    const r = writeConfig(validConfig);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Errore scrittura/);
  });

  it('persiste i dati parsati (version default = 1)', () => {
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
    let written = '';
    vi.mocked(fs.writeFileSync).mockImplementation((_p, content) => {
      written = content as string;
    });
    const configSenzaVersion = { ...validConfig };
    delete (configSenzaVersion as any).version;
    writeConfig(configSenzaVersion);
    const parsed = JSON.parse(written);
    expect(parsed.version).toBe(1);
  });
});

// --- configExists ---

describe('configExists', () => {
  it('ritorna true se file esiste', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    expect(configExists()).toBe(true);
  });

  it('ritorna false se file non esiste', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    expect(configExists()).toBe(false);
  });
});

// --- redactConfig ---

describe('redactConfig', () => {
  it('maschera api_key', () => {
    const r = redactConfig({ api_key: 'sk-ant-supersecret' } as any);
    expect(r.api_key).toBe('sk-a****');
  });

  it('maschera bot_token', () => {
    const r = redactConfig({ bot_token: '123456:ABCDEF' } as any);
    expect(r.bot_token).toBe('1234****');
  });

  it('maschera session_token', () => {
    const r = redactConfig({ session_token: 'mysessiontoken' } as any);
    expect(r.session_token).toBe('myse****');
  });

  it('non altera campi non sensibili', () => {
    const r = redactConfig({ active_provider: 'claude', workspace: '/home' } as any);
    expect(r.active_provider).toBe('claude');
    expect(r.workspace).toBe('/home');
  });

  it('maschera campi sensibili annidati', () => {
    const r = redactConfig({
      providers: { claude: { api_key: 'sk-ant-deep' } },
    } as any);
    expect((r.providers as any).claude.api_key).toBe('sk-a****');
  });

  it('non maschera campi sensibili vuoti', () => {
    const r = redactConfig({ api_key: '' } as any);
    expect(r.api_key).toBe('');
  });
});
