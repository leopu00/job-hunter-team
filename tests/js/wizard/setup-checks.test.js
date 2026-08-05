import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const execSync = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({ execSync }));

import { checkPrerequisites, runHealthCheck } from '../../../cli/wizard/setup-checks.js';

function createPrompter() {
  const progress = { stop: vi.fn() };
  return {
    progress: vi.fn(() => progress),
    note: vi.fn(async () => {}),
    confirm: vi.fn(async () => false),
    progressState: progress,
  };
}

describe('setup checks — Phase 1 English under an inherited Italian locale', () => {
  const originalLang = process.env.JHT_LANG;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JHT_LANG = 'it';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalLang === undefined) delete process.env.JHT_LANG;
    else process.env.JHT_LANG = originalLang;
  });

  it('renders the prerequisite failure path in English', async () => {
    execSync.mockImplementation(() => { throw new Error('not found'); });
    const prompter = createPrompter();

    await expect(checkPrerequisites(prompter)).resolves.toBe(false);

    expect(prompter.progress).toHaveBeenCalledWith('Checking prerequisites...');
    expect(prompter.progressState.stop).toHaveBeenCalledWith('Problems found');
    expect(prompter.note).toHaveBeenCalledWith('npm was not found in PATH', 'Missing prerequisites');
    expect(prompter.confirm).toHaveBeenCalledWith({
      message: 'Continue anyway?',
      initialValue: false,
    });
  });

  it('renders the health-check connection failure in English', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const prompter = createPrompter();

    await expect(runHealthCheck(prompter, { value: 'claude' }, 'test-key')).resolves.toBe(false);

    expect(prompter.progress).toHaveBeenCalledWith('Checking API key...');
    expect(prompter.progressState.stop).toHaveBeenCalledWith('Connection error: offline');
  });
});
