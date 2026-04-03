import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs');

import * as fs from 'node:fs';
import {
  readConfigFileSnapshot,
  validateConfigBeforeWrite,
  writeConfigFile,
  summarizeExistingConfig,
} from '../../../cli/wizard/setup-helpers.js';

beforeEach(() => vi.clearAllMocks());

// --- readConfigFileSnapshot ---

describe('readConfigFileSnapshot', () => {
  it('ritorna exists=false se file non esiste', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const r = readConfigFileSnapshot();
    expect(r.exists).toBe(false);
    expect(r.config).toBeNull();
  });

  it('ritorna exists=true e config parsata se file valido', () => {
    const cfg = { active_provider: 'claude', version: 1 };
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cfg));
    const r = readConfigFileSnapshot();
    expect(r.exists).toBe(true);
    expect(r.config).toMatchObject(cfg);
  });

  it('ritorna config=null per JSON non valido', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('{ bad json');
    const r = readConfigFileSnapshot();
    expect(r.exists).toBe(true);
    expect(r.config).toBeNull();
  });
});

// --- validateConfigBeforeWrite ---

const validCfg = {
  version: 1,
  active_provider: 'claude',
  providers: { claude: { name: 'claude', auth_method: 'api_key', api_key: 'sk-ant-key' } },
  channels: {},
  workspace: '/tmp/test-jht',
};

describe('validateConfigBeforeWrite', () => {
  it('valida config corretta', () => {
    expect(validateConfigBeforeWrite(validCfg).success).toBe(true);
  });

  it('rifiuta active_provider non valido', () => {
    const r = validateConfigBeforeWrite({ ...validCfg, active_provider: 'grok' });
    expect(r.success).toBe(false);
  });

  it('rifiuta active_provider senza config in providers', () => {
    const r = validateConfigBeforeWrite({ ...validCfg, active_provider: 'openai' });
    expect(r.success).toBe(false);
  });

  it('rifiuta api_key mancante per auth_method api_key', () => {
    const r = validateConfigBeforeWrite({
      ...validCfg,
      providers: { claude: { name: 'claude', auth_method: 'api_key' } },
    });
    expect(r.success).toBe(false);
  });

  it('rifiuta subscription mancante per auth_method subscription', () => {
    const r = validateConfigBeforeWrite({
      ...validCfg,
      active_provider: 'minimax',
      providers: { minimax: { name: 'minimax', auth_method: 'subscription' } },
    });
    expect(r.success).toBe(false);
  });

  it('rifiuta workspace mancante', () => {
    const r = validateConfigBeforeWrite({ ...validCfg, workspace: '' });
    expect(r.success).toBe(false);
  });
});

// --- writeConfigFile ---

describe('writeConfigFile', () => {
  it('scrive file per config valida', () => {
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    expect(() => writeConfigFile(validCfg)).not.toThrow();
    expect(fs.writeFileSync).toHaveBeenCalled();
  });

  it('lancia eccezione per config non valida', () => {
    expect(() => writeConfigFile({ active_provider: 'invalid' })).toThrow(/Config non valida/);
  });
});

// --- summarizeExistingConfig ---

describe('summarizeExistingConfig', () => {
  it('mostra provider, modello, auth, workspace', () => {
    const summary = summarizeExistingConfig({
      active_provider: 'claude',
      providers: { claude: { model: 'claude-sonnet-4-6', auth_method: 'api_key' } },
      workspace: '/tmp/test-jht',
    });
    expect(summary).toMatch(/Claude/i);
    expect(summary).toMatch(/claude-sonnet-4-6/);
    expect(summary).toMatch(/api_key/);
    expect(summary).toMatch(/\/tmp\/test-jht/);
  });

  it('mostra Telegram configurato se presente', () => {
    const summary = summarizeExistingConfig({
      active_provider: 'claude',
      providers: { claude: { auth_method: 'api_key' } },
      channels: { telegram: { bot_token: '123:ABC' } },
      workspace: '/home',
    });
    expect(summary).toMatch(/Telegram/);
  });

  it('ritorna stringa non vuota per config vuota', () => {
    const summary = summarizeExistingConfig({});
    expect(typeof summary).toBe('string');
    expect(summary.length).toBeGreaterThan(0);
  });
});
