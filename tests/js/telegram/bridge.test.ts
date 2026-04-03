import { describe, it, expect, vi, beforeEach } from 'vitest';

// grammy, auto-retry e runner sono sostituiti dagli alias in vitest.config.mjs
vi.mock('../../../shared/telegram/bot.js', () => ({
  createBot: vi.fn(),
  registerMessageHandler: vi.fn(),
}));

import { TelegramBridge, sendTextMessage } from '../../../shared/telegram/bridge.js';
import { createBot } from '../../../shared/telegram/bot.js';
import { getSequentialKey } from '../../../shared/telegram/types.js';

function makeMockBot() {
  return {
    api: {
      config: { use: vi.fn() },
      sendMessage: vi.fn().mockResolvedValue({ message_id: 42 }),
      sendChatAction: vi.fn().mockResolvedValue({}),
      getMe: vi.fn().mockResolvedValue({ username: 'test_bot' }),
    },
    use: vi.fn(),
    catch: vi.fn(),
    on: vi.fn(),
    start: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createBot).mockReturnValue(makeMockBot() as any);
});

// --- sendTextMessage ---

describe('sendTextMessage', () => {
  it('chiama sendMessage con parametri corretti', async () => {
    const bot = makeMockBot() as any;
    const r = await sendTextMessage(bot, { chatId: '100', text: 'Ciao' });
    expect(bot.api.sendMessage).toHaveBeenCalledWith(
      100, 'Ciao', expect.objectContaining({ parse_mode: 'HTML' }),
    );
    expect(r.success).toBe(true);
    expect(r.messageId).toBe(42);
  });

  it('ritorna success=false su errore API', async () => {
    const bot = makeMockBot() as any;
    bot.api.sendMessage.mockRejectedValue(new Error('Bad Gateway'));
    const r = await sendTextMessage(bot, { chatId: '1', text: 'test' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Bad Gateway/);
  });

  it('chunka testo > 4096 caratteri in più chiamate', async () => {
    const bot = makeMockBot() as any;
    bot.api.sendMessage.mockResolvedValue({ message_id: 1 });
    await sendTextMessage(bot, { chatId: '1', text: 'x'.repeat(5000) });
    expect(bot.api.sendMessage.mock.calls.length).toBeGreaterThan(1);
  });

  it('riprova senza threadId su TOPIC_CLOSED', async () => {
    const bot = makeMockBot() as any;
    bot.api.sendMessage
      .mockRejectedValueOnce(new Error('TOPIC_CLOSED'))
      .mockResolvedValueOnce({ message_id: 2 });
    const r = await sendTextMessage(bot, { chatId: '1', text: 'msg', threadId: 99 });
    expect(r.success).toBe(true);
    expect(bot.api.sendMessage).toHaveBeenCalledTimes(2);
    const secondCallOpts = bot.api.sendMessage.mock.calls[1][2];
    expect(secondCallOpts.message_thread_id).toBeUndefined();
  });

  it('usa il parseMode passato (MarkdownV2)', async () => {
    const bot = makeMockBot() as any;
    await sendTextMessage(bot, { chatId: '1', text: 'md', parseMode: 'MarkdownV2' });
    expect(bot.api.sendMessage).toHaveBeenCalledWith(
      1, 'md', expect.objectContaining({ parse_mode: 'MarkdownV2' }),
    );
  });
});

// --- TelegramBridge ---

describe('TelegramBridge', () => {
  it('stato iniziale: running=false, tutti i contatori a zero', () => {
    const b = new TelegramBridge('tok');
    const s = b.getStatus();
    expect(s.running).toBe(false);
    expect(s.messagesReceived).toBe(0);
    expect(s.messagesSent).toBe(0);
    expect(s.errors).toBe(0);
  });

  it('send() incrementa messagesSent e ritorna successo', async () => {
    const b = new TelegramBridge('tok');
    const r = await b.send({ chatId: '1', text: 'hello' });
    expect(r.success).toBe(true);
    expect(b.getStatus().messagesSent).toBe(1);
  });

  it('stop() imposta running=false', async () => {
    const b = new TelegramBridge('tok');
    await b.stop();
    expect(b.getStatus().running).toBe(false);
  });

  it('getBot() ritorna istanza non nulla', () => {
    const b = new TelegramBridge('tok');
    expect(b.getBot()).toBeDefined();
  });
});

// --- getSequentialKey ---

describe('getSequentialKey', () => {
  it('ritorna chat:ID senza threadId', () => {
    expect(getSequentialKey('42')).toBe('chat:42');
  });

  it('include thread:N quando presente', () => {
    expect(getSequentialKey('42', 7)).toBe('chat:42:thread:7');
  });
});
