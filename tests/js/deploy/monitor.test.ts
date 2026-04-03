import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({ execSync: vi.fn() }));
vi.mock('node:fs', () => ({ existsSync: vi.fn(), readFileSync: vi.fn() }));

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { buildReport } from '../../../shared/deploy/monitor.js';

beforeEach(() => vi.clearAllMocks());

// Forum log fixture
const FORUM_LINE_INFO =
  '[2026-04-03 10:00:00] [Ace] Missione avviata, tutto ok';
const FORUM_LINE_WARN =
  '[2026-04-03 10:01:00] [Tom] attenzione: test in corso';
const FORUM_LINE_ERR =
  '[2026-04-03 10:02:00] [Dan] [URG] errore critico rilevato';
const FORUM_3_LINES =
  [FORUM_LINE_INFO, FORUM_LINE_WARN, FORUM_LINE_ERR].join('\n') + '\n';

// --- buildReport — file log ---

describe('buildReport — file log', () => {
  it('ritorna entries vuoto se forum.log non esiste', () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(execSync).mockReturnValue('' as any);
    const r = buildReport({});
    expect(r.entries).toHaveLength(0);
    expect(r.errorCount).toBe(0);
  });

  it('parsa correttamente ts, agent e message', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(FORUM_LINE_INFO + '\n');
    vi.mocked(execSync).mockReturnValue('' as any);
    const r = buildReport({});
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0].ts).toBe('2026-04-03 10:00:00');
    expect(r.entries[0].agent).toBe('Ace');
    expect(r.entries[0].message).toContain('Missione avviata');
  });

  it('rileva livello error per righe con [URG]', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(FORUM_LINE_ERR + '\n');
    vi.mocked(execSync).mockReturnValue('' as any);
    const r = buildReport({});
    expect(r.entries[0].level).toBe('error');
    expect(r.errorCount).toBe(1);
  });

  it('rileva livello warn per righe con "attenzione"', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(FORUM_LINE_WARN + '\n');
    vi.mocked(execSync).mockReturnValue('' as any);
    const r = buildReport({});
    expect(r.entries[0].level).toBe('warn');
    expect(r.warnCount).toBe(1);
  });

  it('rileva livello info per righe normali', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(FORUM_LINE_INFO + '\n');
    vi.mocked(execSync).mockReturnValue('' as any);
    const r = buildReport({});
    expect(r.entries[0].level).toBe('info');
  });

  it('conta errorCount e warnCount correttamente', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(FORUM_3_LINES);
    vi.mocked(execSync).mockReturnValue('' as any);
    const r = buildReport({});
    expect(r.errorCount).toBe(1);
    expect(r.warnCount).toBe(1);
  });
});

// --- buildReport — filtri ---

describe('buildReport — filtri', () => {
  beforeEach(() => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(FORUM_3_LINES);
    vi.mocked(execSync).mockReturnValue('' as any);
  });

  it('agentFilter filtra per nome agente', () => {
    const r = buildReport({ agentFilter: 'Ace' });
    expect(r.entries.every((e) => e.agent.toLowerCase().includes('ace'))).toBe(true);
  });

  it('agentFilter case-insensitive', () => {
    const r = buildReport({ agentFilter: 'ace' });
    expect(r.entries.length).toBeGreaterThan(0);
  });

  it('tail limita il numero di righe restituite', () => {
    const manyLines = Array.from({ length: 200 }, (_, i) =>
      `[2026-04-03 10:${String(i).padStart(2, '0')}:00] [Ace] msg ${i}`,
    ).join('\n');
    vi.mocked(readFileSync).mockReturnValue(manyLines + '\n');
    const r = buildReport({ tail: 10 });
    expect(r.entries.length).toBeLessThanOrEqual(10);
  });
});

// --- buildReport — sessioni tmux ---

describe('buildReport — sessioni tmux', () => {
  beforeEach(() => {
    vi.mocked(existsSync).mockReturnValue(false);
  });

  it('elenca solo sessioni che iniziano con JHT-', () => {
    vi.mocked(execSync).mockReturnValue('JHT-QA\nJHT-GATEKEEPER\naltra-sessione\n' as any);
    const r = buildReport({});
    expect(r.agents).toHaveLength(2);
    expect(r.agents.every((a) => a.session.startsWith('JHT-'))).toBe(true);
  });

  it('agents vuoto se nessuna sessione JHT attiva', () => {
    vi.mocked(execSync).mockReturnValue('' as any);
    const r = buildReport({});
    expect(r.agents).toHaveLength(0);
  });

  it('struttura AgentStatus corretta (name, session, active)', () => {
    vi.mocked(execSync).mockReturnValue('JHT-QA\n' as any);
    const r = buildReport({});
    expect(r.agents[0]).toMatchObject({ name: 'QA', session: 'JHT-QA', active: true });
  });
});
