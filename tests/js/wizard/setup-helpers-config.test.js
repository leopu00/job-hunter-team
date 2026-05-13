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

  it('accetta auth_method subscription senza blocco subscription esplicito', () => {
    // Il blocco "subscription" non e' piu' obbligatorio: l'auth e' OAuth
    // device-flow del CLI provider (Claude / Codex / Kimi), che salva il
    // token in ~/.claude/ etc. dentro al container, non nel jht.config.json.
    const r = validateConfigBeforeWrite({
      ...validCfg,
      active_provider: 'kimi',
      providers: { kimi: { name: 'kimi', auth_method: 'subscription' } },
    });
    expect(r.success).toBe(true);
  });

  it('accetta config senza workspace (path JHT fissi)', () => {
    const { workspace, ...cfg } = { ...validCfg, workspace: '/obsolete' };
    expect(validateConfigBeforeWrite(cfg).success).toBe(true);
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
  it('mostra provider, modello, auth', () => {
    const summary = summarizeExistingConfig({
      active_provider: 'claude',
      providers: { claude: { model: 'claude-sonnet-4-6', auth_method: 'api_key' } },
    });
    expect(summary).toMatch(/Claude/i);
    expect(summary).toMatch(/claude-sonnet-4-6/);
    expect(summary).toMatch(/api_key/);
    // workspace non e' piu' parte del summary (path JHT fissi)
    expect(summary).not.toMatch(/Workspace/);
  });

  it('mostra Telegram 3/3 quando tutti i bot sono configurati', () => {
    const summary = summarizeExistingConfig({
      active_provider: 'claude',
      providers: { claude: { auth_method: 'api_key' } },
      channels: {
        telegram: {
          bots: {
            assistente: { bot_token: '111:AAA' },
            capitano:   { bot_token: '222:BBB' },
            mentor:     { bot_token: '333:CCC' },
          },
        },
      },
    });
    expect(summary).toMatch(/Telegram: 3 bot configurati/);
  });

  it('mostra Telegram incompleto quando manca un bot', () => {
    const summary = summarizeExistingConfig({
      active_provider: 'claude',
      providers: { claude: { auth_method: 'api_key' } },
      channels: {
        telegram: {
          bots: {
            assistente: { bot_token: '111:AAA' },
            capitano:   { bot_token: '222:BBB' },
          },
        },
      },
    });
    expect(summary).toMatch(/Telegram: incompleto \(2\/3 bot\)/);
  });

  it('ritorna stringa non vuota per config vuota', () => {
    const summary = summarizeExistingConfig({});
    expect(typeof summary).toBe('string');
    expect(summary.length).toBeGreaterThan(0);
  });
});
