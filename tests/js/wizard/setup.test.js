import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock node:fs e setup-helpers per evitare scritture reali.
vi.mock('node:fs');
vi.mock('../../../cli/wizard/setup-helpers.js', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    writeConfigFile: vi.fn(),
    readConfigFileSnapshot: vi.fn(() => ({ exists: false, config: null })),
  };
});
vi.mock('../../../cli/wizard/setup-checks.js', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    checkPrerequisites: vi.fn(async () => true),
    runHealthCheck: vi.fn(async () => true),
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
  // Test env non ha JHT_HOST_TYPE → wizard salta lo step VPS-FIRST e
  // lo step Telegram-required. L'unico select e' il provider.
  delete process.env.JHT_HOST_TYPE;
});

describe('runSetupWizard — VPS senza account cloud', () => {
  it('salva il provider anche quando l’utente salta il pairing facoltativo', async () => {
    process.env.JHT_HOST_TYPE = 'vps';
    const prompter = createMockPrompter({
      selects: ['claude'],
      // skip cloud; poi non proseguire oltre il provider update sintetico.
      confirms: [false, false],
    });

    await runSetupWizard(prompter);

    expect(writeConfigFile).toHaveBeenCalledOnce();
    const [savedConfig] = vi.mocked(writeConfigFile).mock.calls[0];
    expect(savedConfig.active_provider).toBe('claude');
    expect(prompter.confirm).toHaveBeenNthCalledWith(1, expect.objectContaining({
      initialValue: true,
    }));
  });

  it('prosegue se il pairing facoltativo fallisce', async () => {
    process.env.JHT_HOST_TYPE = 'vps';
    const prompter = createMockPrompter({
      selects: ['claude'],
      // prova il cloud (il comando sintetico fallisce); poi ferma il post-save.
      confirms: [true, false],
    });

    await runSetupWizard(prompter);

    expect(writeConfigFile).toHaveBeenCalledOnce();
    expect(prompter.note).toHaveBeenCalledWith(
      'wizard.cloud.pairing_failed',
      'wizard.cloud.pairing_title',
    );
  });
});

// Note di design (post-refactor 2026-05):
// - Il wizard e' "quickstart" hardcoded (ADR-0004 → niente prompt setup-mode).
// - auth_method = 'subscription' hardcoded (niente prompt api_key/subscription).
// - Il modello e' il primo della lista del provider scelto (niente prompt modello).
// - Telegram inline solo se JHT_HOST_TYPE=vps (in test e' undefined).
// - Post-save: providers update via spawnSync(jht). In test l'eseguibile
//   non esiste → fallisce → wizard chiede confirm "salva comunque?". I test
//   passano `confirms: [false]` per uscire pulito dopo writeConfigFile.

// --- Flow base: nuovo config, un provider per volta ---

describe('runSetupWizard — provider Claude (subscription)', () => {
  it('salva config Claude con auth subscription', async () => {
    const prompter = createMockPrompter({
      selects: ['claude'],
      confirms: [false], // exit dopo providers update fail
    });

    await runSetupWizard(prompter);

    expect(writeConfigFile).toHaveBeenCalledOnce();
    const [savedConfig] = vi.mocked(writeConfigFile).mock.calls[0];
    expect(savedConfig.active_provider).toBe('claude');
    expect(savedConfig.providers.claude.auth_method).toBe('subscription');
    expect(savedConfig.providers.claude.name).toBe('claude');
    expect(savedConfig.providers.claude.model).toBe('claude-sonnet-4-6');
    expect(savedConfig.version).toBe(1);
  });

  it('chiama intro e outro del prompter', async () => {
    const prompter = createMockPrompter({
      selects: ['claude'],
      confirms: [false],
    });

    await runSetupWizard(prompter);

    expect(prompter.intro).toHaveBeenCalled();
    expect(prompter.outro).toHaveBeenCalled();
  });
});

describe('runSetupWizard — provider OpenAI (subscription)', () => {
  it('salva config OpenAI con auth subscription', async () => {
    const prompter = createMockPrompter({
      selects: ['openai'],
      confirms: [false],
    });

    await runSetupWizard(prompter);

    const [savedConfig] = vi.mocked(writeConfigFile).mock.calls[0];
    expect(savedConfig.active_provider).toBe('openai');
    expect(savedConfig.providers.openai.auth_method).toBe('subscription');
    expect(savedConfig.providers.openai.model).toBe('gpt-4o');
  });
});

describe('runSetupWizard — provider Kimi (subscription)', () => {
  it('salva config Kimi con auth subscription', async () => {
    const prompter = createMockPrompter({
      selects: ['kimi'],
      confirms: [false],
    });

    await runSetupWizard(prompter);

    const [savedConfig] = vi.mocked(writeConfigFile).mock.calls[0];
    expect(savedConfig.active_provider).toBe('kimi');
    expect(savedConfig.providers.kimi.auth_method).toBe('subscription');
    expect(savedConfig.providers.kimi.model).toBe('kimi-k2-0905-preview');
  });
});

// --- Config esistente ---

describe('runSetupWizard — config esistente', () => {
  const existingConfig = {
    active_provider: 'claude',
    providers: {
      claude: {
        name: 'claude',
        auth_method: 'subscription',
        model: 'claude-sonnet-4-6',
      },
    },
    channels: {},
    workspace: '/tmp/test-jht',
  };

  it('non salva se utente sceglie "mantieni"', async () => {
    vi.mocked(readConfigFileSnapshot).mockReturnValue({
      exists: true,
      config: existingConfig,
    });

    const prompter = createMockPrompter({
      selects: ['keep'],
    });

    await runSetupWizard(prompter);

    expect(writeConfigFile).not.toHaveBeenCalled();
    expect(prompter.outro).toHaveBeenCalled();
  });

  it('ricomincia da zero se utente sceglie "reset"', async () => {
    vi.mocked(readConfigFileSnapshot).mockReturnValue({
      exists: true,
      config: existingConfig,
    });

    const prompter = createMockPrompter({
      selects: ['reset', 'kimi'],
      confirms: [false],
    });

    await runSetupWizard(prompter);

    expect(writeConfigFile).toHaveBeenCalledOnce();
    const [savedConfig] = vi.mocked(writeConfigFile).mock.calls[0];
    expect(savedConfig.active_provider).toBe('kimi');
    expect(savedConfig.providers.kimi.auth_method).toBe('subscription');
  });

  it('preserva providers esistenti se utente sceglie "modify"', async () => {
    vi.mocked(readConfigFileSnapshot).mockReturnValue({
      exists: true,
      config: existingConfig,
    });

    const prompter = createMockPrompter({
      selects: ['modify', 'openai'],
      confirms: [false],
    });

    await runSetupWizard(prompter);

    const [savedConfig] = vi.mocked(writeConfigFile).mock.calls[0];
    expect(savedConfig.active_provider).toBe('openai');
    // claude pre-esistente preservato
    expect(savedConfig.providers.claude).toBeDefined();
    expect(savedConfig.providers.openai).toBeDefined();
  });
});
