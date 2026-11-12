import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { offeredInRelease } from '../../../shared/runtime/release-providers.js';
// Codex (and Pi with ChatGPT) is kept in the code for the next release but not offered in this one (shared/runtime/release-providers.js):
// these cases run again as soon as it is back in that list.
const codexOffered = offeredInRelease('openai');

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

  it.skipIf(!codexOffered)('keeps the save-anyway warning in English', async () => {
    await runNonInteractiveSetup({
      provider: 'openai',
      authMethod: 'api_key',
      secretMode: 'plaintext',
      apiKey: 'sk-proj-api-key-long-enough',
    });

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Health check failed — configuration will still be saved.')
    );
    expect(writeConfigFile).toHaveBeenCalledOnce();
  });

  it('refuses a provider that is no longer offered and saves nothing', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const before = process.exitCode;
    for (const provider of ['claude', 'openai', ...(offeredInRelease('kimi') ? [] : ['kimi'])]) {
      process.exitCode = 0;
      await runNonInteractiveSetup({
        provider, authMethod: 'api_key', secretMode: 'plaintext', apiKey: 'sk-ant-api-key-long-enough',
      });
      expect(process.exitCode, provider).toBe(1);
    }
    expect(writeConfigFile).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('This release offers only'));
    process.exitCode = before;
    errSpy.mockRestore();
  });
});
