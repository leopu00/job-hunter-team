import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LATEST_CONFIG_VERSION } from '../../../cli/src/commands/migrate.js';
import { CODEX_MODEL } from '../../../shared/runtime/role-models.js';

// Mock node:fs e setup-helpers per evitare scritture reali.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal();
  const { mockFsWithRoleModels } = await import('../helpers/mock-fs-with-role-models.js');
  return mockFsWithRoleModels(actual, vi);
});
// The first question of the setup is the language; it has its own tests (cli/tests/setup-language.test.mjs). Here it is answered.
vi.mock('../../../cli/wizard/setup-language.js', () => ({ askLanguage: vi.fn(async () => 'en') }));
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
      selects: ['openai'],
      // skip cloud; poi non proseguire oltre il provider update sintetico.
      confirms: [false, false],
    });

    await runSetupWizard(prompter);

    expect(writeConfigFile).toHaveBeenCalledOnce();
    const [savedConfig] = vi.mocked(writeConfigFile).mock.calls[0];
    expect(savedConfig.active_provider).toBe('openai');
    expect(prompter.confirm).toHaveBeenNthCalledWith(1, expect.objectContaining({
      initialValue: true,
    }));
  });

  it('prosegue se il pairing facoltativo fallisce', async () => {
    process.env.JHT_HOST_TYPE = 'vps';
    const prompter = createMockPrompter({
      selects: ['openai'],
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

describe('runSetupWizard — intro e outro', () => {
  it('chiama intro e outro del prompter', async () => {
    const prompter = createMockPrompter({
      selects: ['openai'],
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
    expect(savedConfig.providers.openai.model).toBe(CODEX_MODEL.sol);
    // a new config is born at the latest version: nothing to migrate for the first `jht doctor`
    expect(savedConfig.version).toBe(LATEST_CONFIG_VERSION);
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
      selects: ['reset', 'openai'],
      confirms: [false],
    });

    await runSetupWizard(prompter);

    expect(writeConfigFile).toHaveBeenCalledOnce();
    const [savedConfig] = vi.mocked(writeConfigFile).mock.calls[0];
    expect(savedConfig.active_provider).toBe('openai');
    expect(savedConfig.providers.openai.auth_method).toBe('subscription');
    // il reset toglie anche il provider archiviato della vecchia configurazione
    expect(savedConfig.providers.claude).toBeUndefined();
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

describe('runSetupWizard — provider proposto', () => {
  it('dice che il provider è Codex senza chiederlo: con una sola scelta non c’è domanda, e Claude e Kimi non si possono scegliere', async () => {
    const prompter = createMockPrompter({ selects: [], confirms: [false, false] });

    await runSetupWizard(prompter);

    // nessuna domanda con una sola risposta: il provider è una riga, e la configurazione lo salva
    expect(prompter.select.mock.calls.some(([p]) => p?.options?.some((o) => o.value === 'openai'))).toBe(false);
    expect(prompter.note.mock.calls.some(([, title]) => title === 'wizard.provider.prompt' || title === 'AI Provider')).toBe(true);
    const [savedConfig] = vi.mocked(writeConfigFile).mock.calls[0];
    expect(savedConfig.active_provider).toBe('openai');
  });
});
