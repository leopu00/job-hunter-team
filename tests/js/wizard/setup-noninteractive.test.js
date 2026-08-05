import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../cli/wizard/setup-checks.js', () => ({
  runHealthCheck: vi.fn(async () => false),
}));
vi.mock('../../../cli/wizard/setup-helpers.js', async (importOriginal) => ({
  ...(await importOriginal()),
  writeConfigFile: vi.fn(),
}));

import { runNonInteractiveSetup } from '../../../cli/wizard/setup-noninteractive.js';
import { writeConfigFile } from '../../../cli/wizard/setup-helpers.js';

describe('runNonInteractiveSetup — Phase 1 health failure', () => {
  const originalLang = process.env.JHT_LANG;
  let logSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JHT_LANG = 'it';
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    if (originalLang === undefined) delete process.env.JHT_LANG;
    else process.env.JHT_LANG = originalLang;
  });

  it('keeps the save-anyway warning in English', async () => {
    await runNonInteractiveSetup({
      provider: 'claude',
      authMethod: 'api_key',
      secretMode: 'plaintext',
      apiKey: 'sk-ant-api-key-long-enough',
    });

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Health check failed — configuration will still be saved.')
    );
    expect(writeConfigFile).toHaveBeenCalledOnce();
  });
});
