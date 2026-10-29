import { describe, it, expect, vi, beforeEach } from 'vitest';

// Gate CLI Linux 19i (A4): after the wait for the login ran out, `jht setup` → «Keep existing values» ended without
// asking for the login that was still missing.
vi.mock('node:fs');
vi.mock('../../../cli/wizard/setup-helpers.js', async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, writeConfigFile: vi.fn(), readConfigFileSnapshot: vi.fn(() => ({ exists: false, config: null })) };
});
vi.mock('../../../cli/wizard/setup-checks.js', async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, checkPrerequisites: vi.fn(async () => true), runHealthCheck: vi.fn(async () => true) };
});
vi.mock('../../../cli/wizard/provider-login.js', () => ({ runProviderLoginStep: vi.fn(async () => '/jht_home/.codex/auth.json') }));

import { writeConfigFile, readConfigFileSnapshot } from '../../../cli/wizard/setup-helpers.js';
import { runProviderLoginStep } from '../../../cli/wizard/provider-login.js';
import { runSetupWizard } from '../../../cli/wizard/setup.js';
import { t } from '../../../cli/wizard/i18n.js';

function prompter(selects) {
  let at = 0;
  return {
    intro: vi.fn(async () => {}), outro: vi.fn(async () => {}), note: vi.fn(async () => {}),
    select: vi.fn(async () => selects[at++]), text: vi.fn(async () => ''), confirm: vi.fn(async () => false),
    progress: vi.fn(() => ({ update: vi.fn(), stop: vi.fn() })),
  };
}

const kept = (provider) => ({ active_provider: provider, providers: provider ? { [provider]: { auth_method: 'subscription' } } : {}, channels: {} });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(runProviderLoginStep).mockResolvedValue('/jht_home/.codex/auth.json');
  delete process.env.JHT_HOST_TYPE;
});

describe('jht setup — «Keep existing values» and the provider login', () => {
  it('asks for the login of the kept provider, and ends as kept once it is there', async () => {
    vi.mocked(readConfigFileSnapshot).mockReturnValue({ exists: true, config: kept('openai') });
    const asked = prompter(['keep']);

    await runSetupWizard(asked);

    expect(runProviderLoginStep).toHaveBeenCalledOnce();
    expect(vi.mocked(runProviderLoginStep).mock.calls[0][0]).toMatchObject({ cmdName: 'codex', isVps: false });
    expect(writeConfigFile).not.toHaveBeenCalled();
    expect(asked.outro).toHaveBeenCalledWith(t('wizard.config_kept'));
  });

  it('stops with the login message when the login does not come, and does not say the configuration is kept', async () => {
    vi.mocked(readConfigFileSnapshot).mockReturnValue({ exists: true, config: kept('openai') });
    vi.mocked(runProviderLoginStep).mockResolvedValue(null);
    const asked = prompter(['keep']);

    await runSetupWizard(asked);

    expect(asked.outro).toHaveBeenCalledOnce();
    expect(asked.outro).toHaveBeenCalledWith(t('wizard.oauth.aborted'));
    expect(writeConfigFile).not.toHaveBeenCalled();
  });

  it('asks nothing for a kept provider the wizard does not offer', async () => {
    vi.mocked(readConfigFileSnapshot).mockReturnValue({ exists: true, config: kept('claude') });
    await runSetupWizard(prompter(['keep']));
    expect(runProviderLoginStep).not.toHaveBeenCalled();
  });

  it('has nothing to ask when the kept configuration names no provider', async () => {
    vi.mocked(readConfigFileSnapshot).mockReturnValue({ exists: true, config: kept(undefined) });
    const asked = prompter(['keep']);

    await runSetupWizard(asked);

    expect(runProviderLoginStep).not.toHaveBeenCalled();
    expect(asked.outro).toHaveBeenCalledWith(t('wizard.config_kept'));
  });

  it('on a VPS the login is asked as over SSH', async () => {
    process.env.JHT_HOST_TYPE = 'vps';
    vi.mocked(readConfigFileSnapshot).mockReturnValue({ exists: true, config: kept('openai') });
    await runSetupWizard(prompter(['keep']));
    expect(vi.mocked(runProviderLoginStep).mock.calls[0][0].isVps).toBe(true);
  });
});
