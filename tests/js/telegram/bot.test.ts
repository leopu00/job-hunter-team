import { describe, it, expect, vi, beforeEach } from 'vitest';

// grammy, auto-retry e runner sono sostituiti dagli alias in vitest.config.mjs
// Mocka solo bridge.js per isolare bot.ts dalla dipendenza circolare
vi.mock('../../../shared/telegram/bridge.js', () => ({
  sendTextMessage: vi.fn().mockResolvedValue({ messageId: 1, chatId: '123', success: true }),
}));

import { Bot } from 'grammy';
import { createBot, registerMessageHandler } from '../../../shared/telegram/bot.js';

beforeEach(() => vi.clearAllMocks());

const baseConfig = {
  token: 'tok-test-123',
  allowedChatIds: [] as string[],
  mode: 'polling' as const,
  textLimit: 4096,
};

// --- createBot ---

describe('createBot', () => {
  it('istanzia Bot con il token della config', () => {
    createBot(baseConfig);
    expect(Bot).toHaveBeenCalledWith('tok-test-123');
  });

  it('applica middleware tramite bot.use', () => {
    const bot = createBot(baseConfig);
    expect(vi.mocked(bot.use)).toHaveBeenCalled();
  });

  it('registra error handler con bot.catch', () => {
    const bot = createBot(baseConfig);
    expect(vi.mocked(bot.catch)).toHaveBeenCalled();
  });

  it('ritorna oggetto bot con api e on', () => {
    const bot = createBot(baseConfig);
    expect(bot.api).toBeDefined();
    expect(typeof bot.on).toBe('function');
  });
});

// --- registerMessageHandler ---

describe('registerMessageHandler', () => {
  it('registra handler sull\'evento "message"', () => {
    const bot = createBot(baseConfig);
    registerMessageHandler(bot, baseConfig, vi.fn());
    expect(vi.mocked(bot.on)).toHaveBeenCalledWith('message', expect.any(Function));
  });

  it('chiama onMessage con InboundMessage estratto correttamente', async () => {
    const bot = createBot(baseConfig);
    const onMessage = vi.fn().mockResolvedValue(null);
    registerMessageHandler(bot, baseConfig, onMessage);

    const [[, handler]] = vi.mocked(bot.on).mock.calls as any;
    await handler({
      message: {
        message_id: 10,
        chat: { id: 55555, type: 'private' },
        from: { id: 1, username: 'tester' },
        text: 'Ciao bot',
        date: 1700000000,
      },
      api: { sendChatAction: vi.fn().mockResolvedValue({}) },
    });

    expect(onMessage).toHaveBeenCalledOnce();
    const [inbound] = onMessage.mock.calls[0];
    expect(inbound.chatId).toBe('55555');
    expect(inbound.text).toBe('Ciao bot');
    expect(inbound.senderUsername).toBe('tester');
  });

  it('ignora messaggi con testo vuoto o whitespace', async () => {
    const bot = createBot(baseConfig);
    const onMessage = vi.fn();
    registerMessageHandler(bot, baseConfig, onMessage);

    const [[, handler]] = vi.mocked(bot.on).mock.calls as any;
    await handler({
      message: {
        message_id: 1, chat: { id: 1, type: 'private' },
        from: { id: 1 }, text: '   ', date: 1700000000,
      },
      api: { sendChatAction: vi.fn() },
    });

    expect(onMessage).not.toHaveBeenCalled();
  });

  it('blocca messaggi da chat non in allowedChatIds', async () => {
    const restrictedCfg = { ...baseConfig, allowedChatIds: ['999'] };
    const bot = createBot(restrictedCfg);
    const onMessage = vi.fn();
    registerMessageHandler(bot, restrictedCfg, onMessage);

    const [[, handler]] = vi.mocked(bot.on).mock.calls as any;
    await handler({
      message: {
        message_id: 1, chat: { id: 12345, type: 'private' },
        from: { id: 1 }, text: 'testo', date: 1700000000,
      },
      api: { sendChatAction: vi.fn() },
    });

    expect(onMessage).not.toHaveBeenCalled();
  });

  it('permette messaggi da chat in allowedChatIds', async () => {
    const allowedCfg = { ...baseConfig, allowedChatIds: ['12345'] };
    const bot = createBot(allowedCfg);
    const onMessage = vi.fn().mockResolvedValue(null);
    registerMessageHandler(bot, allowedCfg, onMessage);

    const [[, handler]] = vi.mocked(bot.on).mock.calls as any;
    await handler({
      message: {
        message_id: 1, chat: { id: 12345, type: 'private' },
        from: { id: 1 }, text: 'testo ok', date: 1700000000,
      },
      api: { sendChatAction: vi.fn().mockResolvedValue({}) },
    });

    expect(onMessage).toHaveBeenCalled();
  });

  it('invia chat action "typing" prima di processare il messaggio', async () => {
    const bot = createBot(baseConfig);
    const onMessage = vi.fn().mockResolvedValue(null);
    registerMessageHandler(bot, baseConfig, onMessage);

    const sendChatAction = vi.fn().mockResolvedValue({});
    const [[, handler]] = vi.mocked(bot.on).mock.calls as any;
    await handler({
      message: {
        message_id: 1, chat: { id: 1, type: 'private' },
        from: { id: 1 }, text: 'ciao', date: 1700000000,
      },
      api: { sendChatAction },
    });

    expect(sendChatAction).toHaveBeenCalledWith(1, 'typing', expect.any(Object));
  });
});
