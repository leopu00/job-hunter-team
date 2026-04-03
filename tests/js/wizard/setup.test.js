import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock node:fs e setup-helpers per evitare scritture reali
vi.mock('node:fs');
vi.mock('../../../cli/wizard/setup-helpers.js', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    writeConfigFile: vi.fn(),
    readConfigFileSnapshot: vi.fn(() => ({ exists: false, config: null })),
  };
});

import * as fs from 'node:fs';
import { writeConfigFile, readConfigFileSnapshot } from '../../../cli/wizard/setup-helpers.js';
import { runSetupWizard } from '../../../cli/wizard/setup.js';

/**
 * Crea un prompter mock che risponde con valori predefiniti.
 */
function createMockPrompter({ selects = [], texts = [], confirms = [] } = {}) {
  let si = 0, ti = 0, ci = 0;
  return {
    intro: vi.fn(async () => {}),
    outro: vi.fn(async () => {}),
    note: vi.fn(async () => {}),
    select: vi.fn(async () => selects[si++]),
    text: vi.fn(async (params) => {
      const val = texts[ti++] ?? '';
      if (params?.validate) {
        const err = params.validate(val);
        if (err) throw new Error(err);
      }
      return val;
    }),
    confirm: vi.fn(async () => confirms[ci++] ?? false),
    progress: vi.fn(() => ({ update: vi.fn(), stop: vi.fn() })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fs.existsSync).mockReturnValue(true);
  vi.mocked(readConfigFileSnapshot).mockReturnValue({ exists: false, config: null });
});

// --- Flusso quickstart Claude + api_key ---

describe('runSetupWizard — Claude api_key quickstart', () => {
  it('completa wizard e salva config Claude', async () => {
    const prompter = createMockPrompter({
      selects: [
        'quickstart',   // modalità setup
        'claude',       // provider AI
        'api_key',      // auth method
        'claude-sonnet-4-6', // modello
      ],
      texts: [
        'sk-ant-apikey1234567', // API key
      ],
      confirms: [false], // no telegram
    });

    await runSetupWizard(prompter);

    expect(writeConfigFile).toHaveBeenCalledOnce();
    const [savedConfig] = vi.mocked(writeConfigFile).mock.calls[0];
    expect(savedConfig.active_provider).toBe('claude');
    expect(savedConfig.providers.claude.auth_method).toBe('api_key');
    expect(savedConfig.providers.claude.api_key).toBe('sk-ant-apikey1234567');
    expect(savedConfig.providers.claude.model).toBe('claude-sonnet-4-6');
    expect(savedConfig.version).toBe(1);
  });

  it('chiama intro e outro del prompter', async () => {
    const prompter = createMockPrompter({
      selects: ['quickstart', 'openai', 'api_key', 'gpt-4o'],
      texts: ['sk-proj-apikey1234567'],
      confirms: [false],
    });

    await runSetupWizard(prompter);

    expect(prompter.intro).toHaveBeenCalled();
    expect(prompter.outro).toHaveBeenCalled();
  });
});

// --- Flusso OpenAI api_key ---

describe('runSetupWizard — OpenAI api_key', () => {
  it('salva config OpenAI correttamente', async () => {
    const prompter = createMockPrompter({
      selects: ['quickstart', 'openai', 'api_key', 'gpt-4o'],
      texts: ['sk-proj-openaikey123456'],
      confirms: [false],
    });

    await runSetupWizard(prompter);

    const [savedConfig] = vi.mocked(writeConfigFile).mock.calls[0];
    expect(savedConfig.active_provider).toBe('openai');
    expect(savedConfig.providers.openai.api_key).toBe('sk-proj-openaikey123456');
  });
});

// --- Flusso MiniMax subscription ---

describe('runSetupWizard — MiniMax subscription', () => {
  it('salva config MiniMax con email', async () => {
    const prompter = createMockPrompter({
      selects: ['quickstart', 'minimax', 'subscription', 'minimax-01'],
      texts: ['user@minimax.com'],
      confirms: [false], // no session token (quickstart), no telegram
    });

    await runSetupWizard(prompter);

    const [savedConfig] = vi.mocked(writeConfigFile).mock.calls[0];
    expect(savedConfig.active_provider).toBe('minimax');
    expect(savedConfig.providers.minimax.auth_method).toBe('subscription');
    expect(savedConfig.providers.minimax.subscription.email).toBe('user@minimax.com');
  });
});

// --- Telegram configurato ---

describe('runSetupWizard — con Telegram', () => {
  it('include canale telegram se configurato', async () => {
    const prompter = createMockPrompter({
      selects: ['quickstart', 'claude', 'api_key', 'claude-sonnet-4-6'],
      texts: [
        'sk-ant-apikey1234567', // API key Claude
        '123456789:ABCdefGHIjklMNO', // bot token
        '987654321', // chat ID
      ],
      confirms: [true], // sì telegram
    });

    await runSetupWizard(prompter);

    const [savedConfig] = vi.mocked(writeConfigFile).mock.calls[0];
    expect(savedConfig.channels.telegram).toBeDefined();
    expect(savedConfig.channels.telegram.bot_token).toBe('123456789:ABCdefGHIjklMNO');
    expect(savedConfig.channels.telegram.chat_id).toBe('987654321');
  });
});

// --- Config esistente: mantieni ---

describe('runSetupWizard — config esistente', () => {
  it('non salva se utente sceglie "mantieni"', async () => {
    vi.mocked(readConfigFileSnapshot).mockReturnValue({
      exists: true,
      config: {
        active_provider: 'claude',
        providers: { claude: { name: 'claude', auth_method: 'api_key', api_key: 'sk-ant-old' } },
        channels: {},
        workspace: '/tmp/test-jht',
      },
    });

    const prompter = createMockPrompter({
      selects: [
        'quickstart',   // modalità
        'keep',         // gestione config esistente
      ],
    });

    await runSetupWizard(prompter);

    expect(writeConfigFile).not.toHaveBeenCalled();
    expect(prompter.outro).toHaveBeenCalled();
  });

  it('ricomincia da zero se utente sceglie "reset"', async () => {
    vi.mocked(readConfigFileSnapshot).mockReturnValue({
      exists: true,
      config: {
        active_provider: 'claude',
        providers: { claude: { name: 'claude', auth_method: 'api_key', api_key: 'sk-ant-old' } },
        channels: {},
        workspace: '/tmp/test-jht',
      },
    });

    const prompter = createMockPrompter({
      selects: ['quickstart', 'reset', 'claude', 'api_key', 'claude-sonnet-4-6'],
      texts: ['sk-ant-newkey123456'],
      confirms: [false],
    });

    await runSetupWizard(prompter);

    expect(writeConfigFile).toHaveBeenCalledOnce();
    const [savedConfig] = vi.mocked(writeConfigFile).mock.calls[0];
    expect(savedConfig.providers.claude.api_key).toBe('sk-ant-newkey123456');
  });
});
