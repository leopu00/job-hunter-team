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

describe('setup checks — in the language of the person', () => {
  const originalLang = process.env.JHT_LANG;
  const originalHome = process.env.JHT_HOME;

  beforeEach(() => {
    vi.clearAllMocks();
    // a home with no i18n-prefs.json: JHT_LANG decides
    process.env.JHT_HOME = '/nonexistent-jht-home-for-setup-checks';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalLang === undefined) delete process.env.JHT_LANG;
    else process.env.JHT_LANG = originalLang;
    if (originalHome === undefined) delete process.env.JHT_HOME;
    else process.env.JHT_HOME = originalHome;
  });

  const cases = [
    ['en', {
      checking: 'Checking prerequisites...', problems: 'Problems found', npm: 'npm was not found in PATH',
      missing: 'Missing prerequisites', cont: 'Continue anyway?', key: 'Checking API key...', conn: 'Connection error: offline',
    }],
    ['it', {
      checking: 'Controllo i requisiti...', problems: 'Problemi trovati', npm: 'npm non si trova nel PATH',
      missing: 'Requisiti mancanti', cont: 'Continuare lo stesso?', key: 'Controllo la chiave API...', conn: 'Errore di connessione: offline',
    }],
    ['de', {
      checking: 'Voraussetzungen werden geprüft...', problems: 'Probleme gefunden', npm: 'npm wurde im PATH nicht gefunden',
      missing: 'Fehlende Voraussetzungen', cont: 'Trotzdem weitermachen?', key: 'API-Schlüssel wird geprüft...', conn: 'Verbindungsfehler: offline',
    }],
  ];

  it.each(cases)('renders the prerequisite failure path in %s', async (lang, x) => {
    process.env.JHT_LANG = lang;
    execSync.mockImplementation(() => { throw new Error('not found'); });
    const prompter = createPrompter();

    await expect(checkPrerequisites(prompter)).resolves.toBe(false);

    expect(prompter.progress).toHaveBeenCalledWith(x.checking);
    expect(prompter.progressState.stop).toHaveBeenCalledWith(x.problems);
    expect(prompter.note).toHaveBeenCalledWith(x.npm, x.missing);
    expect(prompter.confirm).toHaveBeenCalledWith({
      message: x.cont,
      initialValue: false,
    });
  });

  it.each(cases)('renders the health-check connection failure in %s', async (lang, x) => {
    process.env.JHT_LANG = lang;
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const prompter = createPrompter();

    await expect(runHealthCheck(prompter, { value: 'claude' }, 'test-key')).resolves.toBe(false);

    expect(prompter.progress).toHaveBeenCalledWith(x.key);
    expect(prompter.progressState.stop).toHaveBeenCalledWith(x.conn);
  });
});
