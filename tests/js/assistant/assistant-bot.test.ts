/**
 * Test: shared/assistant/assistant-bot.ts
 * classifyIntent, getIntentAck, isOwner, registerAssistantHandlers
 */
import { describe, it, expect, vi } from 'vitest';
import {
  classifyIntent,
  getIntentAck,
  isOwner,
  registerAssistantHandlers,
} from '../../../shared/assistant/assistant-bot.js';
import type { AssistantConfig } from '../../../shared/assistant/types.js';

// ── classifyIntent ──────────────────────────────────────────

describe('classifyIntent', () => {
  it('riconosce job_search', () => {
    const r = classifyIntent('Trovami lavoro come developer');
    expect(r.kind).toBe('job_search');
  });

  it('riconosce status_check', () => {
    expect(classifyIntent('Come va la ricerca?').kind).toBe('status_check');
  });

  it('riconosce list_applications', () => {
    expect(classifyIntent('le mie candidature').kind).toBe('list_applications');
  });

  it('riconosce stop_search', () => {
    expect(classifyIntent('Stop').kind).toBe('stop_search');
  });

  it('riconosce update_profile', () => {
    expect(classifyIntent('Aggiorna il mio profilo').kind).toBe('update_profile');
  });

  it('restituisce unknown per testo non classificabile', () => {
    const r = classifyIntent('Ciao come stai?');
    expect(r.kind).toBe('unknown');
    if (r.kind === 'unknown') expect(r.rawText).toBe('Ciao come stai?');
  });

  it('estrae ruolo dal testo job_search', () => {
    const r = classifyIntent('Trovami lavoro come frontend developer');
    expect(r.kind).toBe('job_search');
    if (r.kind === 'job_search') expect(r.filters?.role).toBeTruthy();
  });

  it('rileva remote nei filtri', () => {
    const r = classifyIntent('cercami lavoro remote da casa');
    if (r.kind === 'job_search') expect(r.filters?.remote).toBe(true);
  });

  it('imposta query uguale al testo originale', () => {
    const r = classifyIntent('trovami un lavoro');
    if (r.kind === 'job_search') expect(r.query).toBe('trovami un lavoro');
  });
});

// ── getIntentAck ────────────────────────────────────────────

describe('getIntentAck', () => {
  it('messaggio per job_search', () => {
    expect(getIntentAck({ kind: 'job_search', query: 'test' })).toMatch(/ricerca/i);
  });

  it('messaggio per status_check', () => {
    expect(getIntentAck({ kind: 'status_check' })).toBeTruthy();
  });

  it('messaggio per list_applications', () => {
    expect(getIntentAck({ kind: 'list_applications' })).toBeTruthy();
  });

  it('messaggio per stop_search', () => {
    expect(getIntentAck({ kind: 'stop_search' })).toBeTruthy();
  });

  it('messaggio per update_profile', () => {
    expect(getIntentAck({ kind: 'update_profile', details: 'x' })).toBeTruthy();
  });

  it('messaggio per unknown suggerisce comandi', () => {
    expect(getIntentAck({ kind: 'unknown', rawText: 'x' })).toMatch(/trovami/i);
  });
});

// ── isOwner ─────────────────────────────────────────────────

describe('isOwner', () => {
  const makeCtx = (id: number) => ({ chat: { id } }) as any;

  it('ritorna true per owner', () => {
    expect(isOwner(makeCtx(123), '123')).toBe(true);
  });

  it('ritorna false per altro utente', () => {
    expect(isOwner(makeCtx(999), '123')).toBe(false);
  });
});

// ── registerAssistantHandlers ────────────────────────────────

describe('registerAssistantHandlers', () => {
  const config: AssistantConfig = {
    botToken: 'tok',
    name: 'TestBot',
    avatar: '🤖',
    ownerChatId: '42',
    captainSession: 'CAPITANO',
    teamResponseTimeoutMs: 5000,
  };

  it('registra handler /start', () => {
    const bot = { command: vi.fn(), on: vi.fn() } as any;
    registerAssistantHandlers(bot, config, vi.fn());
    expect(bot.command).toHaveBeenCalledWith('start', expect.any(Function));
  });

  it('registra handler message:text', () => {
    const bot = { command: vi.fn(), on: vi.fn() } as any;
    registerAssistantHandlers(bot, config, vi.fn());
    expect(bot.on).toHaveBeenCalledWith('message:text', expect.any(Function));
  });

  it('message handler chiama onRequest per intent noto', async () => {
    const bot = { command: vi.fn(), on: vi.fn() } as any;
    const onRequest = vi.fn().mockResolvedValue(undefined);
    registerAssistantHandlers(bot, config, onRequest);

    const handler = bot.on.mock.calls[0][1];
    await handler({
      chat: { id: 42 },
      message: { text: 'trovami lavoro come developer', message_id: 1 },
      reply: vi.fn().mockResolvedValue({}),
    });
    expect(onRequest).toHaveBeenCalled();
  });

  it('message handler NON chiama onRequest per intent unknown', async () => {
    const bot = { command: vi.fn(), on: vi.fn() } as any;
    const onRequest = vi.fn().mockResolvedValue(undefined);
    registerAssistantHandlers(bot, config, onRequest);

    const handler = bot.on.mock.calls[0][1];
    await handler({
      chat: { id: 42 },
      message: { text: 'ciao come stai', message_id: 1 },
      reply: vi.fn().mockResolvedValue({}),
    });
    expect(onRequest).not.toHaveBeenCalled();
  });

  it('message handler ignora messaggi da non-owner', async () => {
    const bot = { command: vi.fn(), on: vi.fn() } as any;
    const onRequest = vi.fn();
    registerAssistantHandlers(bot, config, onRequest);

    const handler = bot.on.mock.calls[0][1];
    await handler({
      chat: { id: 999 },
      message: { text: 'trovami lavoro', message_id: 1 },
      reply: vi.fn(),
    });
    expect(onRequest).not.toHaveBeenCalled();
  });
});
