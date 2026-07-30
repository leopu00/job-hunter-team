/**
 * Test unitari — shared/telegram/bot + bridge
 *
 * Testa createBot, TelegramBridge, sendTextMessage con mock grammy.
 */
import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { createBot } from "./bot.js";
import { TelegramBridge, sendTextMessage } from "./bridge.js";
import type { TelegramBotConfig, OutboundMessage } from "./types.js";
import { DEFAULT_CONFIG } from "./types.js";

// Token fake per test (grammy accetta qualsiasi stringa con :)
const TEST_TOKEN = "123456:ABC-DEF_test_token_fake";

function makeConfig(overrides?: Partial<TelegramBotConfig>): TelegramBotConfig {
  return { ...DEFAULT_CONFIG, token: TEST_TOKEN, ...overrides };
}

// --- createBot ---

describe("createBot", () => {
  it("crea un bot grammy valido", () => {
    const bot = createBot(makeConfig());
    assert.ok(bot);
    assert.ok(typeof bot.on === "function");
    assert.ok(typeof bot.use === "function");
  });

  it("bot ha error handler registrato", () => {
    const bot = createBot(makeConfig());
    // Il bot non lancia su catch handler
    assert.ok(bot.errorHandler);
  });
});

// --- TelegramBridge ---

describe("TelegramBridge", () => {
  it("costruttore inizializza status correttamente", () => {
    const bridge = new TelegramBridge(TEST_TOKEN);
    const status = bridge.getStatus();
    assert.equal(status.running, false);
    assert.equal(status.mode, "polling");
    assert.equal(status.messagesReceived, 0);
    assert.equal(status.messagesSent, 0);
    assert.equal(status.errors, 0);
    assert.equal(status.botUsername, undefined);
  });

  it("costruttore con options sovrascrive mode", () => {
    const bridge = new TelegramBridge(TEST_TOKEN, { mode: "webhook" });
    assert.equal(bridge.getStatus().mode, "webhook");
  });

  it("costruttore con allowedChatIds", () => {
    const bridge = new TelegramBridge(TEST_TOKEN, { allowedChatIds: ["111", "222"] });
    // Bridge creato senza errori — config interna non esposta, ma status OK
    assert.equal(bridge.getStatus().running, false);
  });

  it("getBot ritorna istanza Bot", () => {
    const bridge = new TelegramBridge(TEST_TOKEN);
    const bot = bridge.getBot();
    assert.ok(bot);
    assert.ok(typeof bot.on === "function");
  });

  it("getStatus ritorna copia (non riferimento)", () => {
    const bridge = new TelegramBridge(TEST_TOKEN);
    const s1 = bridge.getStatus();
    const s2 = bridge.getStatus();
    assert.deepEqual(s1, s2);
    s1.errors = 999;
    assert.notEqual(bridge.getStatus().errors, 999);
  });
});

// --- sendTextMessage con mock ---

describe("sendTextMessage", () => {
  it("invia messaggio corto in un singolo chunk", async () => {
    const sent: Array<{ chatId: number; text: string }> = [];
    const mockBot = {
      api: {
        sendMessage: async (chatId: number, text: string, opts: any) => {
          sent.push({ chatId, text });
          return { message_id: 1 };
        },
      },
    } as any;

    const msg: OutboundMessage = { chatId: "100", text: "Ciao mondo" };
    const result = await sendTextMessage(mockBot, msg);
    assert.equal(result.success, true);
    assert.equal(result.chatId, "100");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].text, "Ciao mondo");
  });

  it("chunk testo lungo in piu' messaggi", async () => {
    const sent: string[] = [];
    const mockBot = {
      api: {
        sendMessage: async (_: number, text: string) => {
          sent.push(text);
          return { message_id: sent.length };
        },
      },
    } as any;

    const longText = "x".repeat(5000);
    const msg: OutboundMessage = { chatId: "100", text: longText };
    const result = await sendTextMessage(mockBot, msg);
    assert.equal(result.success, true);
    assert.ok(sent.length >= 2);
    const total = sent.reduce((s, t) => s + t.length, 0);
    assert.equal(total, 5000);
  });

  it("ritorna errore se invio fallisce", async () => {
    const mockBot = {
      api: {
        sendMessage: async () => { throw new Error("network error"); },
      },
    } as any;

    const msg: OutboundMessage = { chatId: "100", text: "test" };
    const result = await sendTextMessage(mockBot, msg);
    assert.equal(result.success, false);
    assert.ok(result.error?.includes("network error"));
  });

  it("retry senza threadId su TOPIC_CLOSED", async () => {
    let attempts = 0;
    const mockBot = {
      api: {
        sendMessage: async (_: number, text: string, opts: any) => {
          attempts++;
          if (attempts === 1 && opts?.message_thread_id) {
            throw new Error("TOPIC_CLOSED");
          }
          return { message_id: attempts };
        },
      },
    } as any;

    const msg: OutboundMessage = { chatId: "100", text: "test", threadId: 5 };
    const result = await sendTextMessage(mockBot, msg);
    assert.equal(result.success, true);
    assert.equal(attempts, 2);
  });

  it("usa parseMode HTML di default", async () => {
    let capturedOpts: any = {};
    const mockBot = {
      api: {
        sendMessage: async (_: number, __: string, opts: any) => {
          capturedOpts = opts;
          return { message_id: 1 };
        },
      },
    } as any;

    await sendTextMessage(mockBot, { chatId: "100", text: "test" });
    assert.equal(capturedOpts.parse_mode, "HTML");
  });

  it("imposta silent quando richiesto", async () => {
    let capturedOpts: any = {};
    const mockBot = {
      api: {
        sendMessage: async (_: number, __: string, opts: any) => {
          capturedOpts = opts;
          return { message_id: 1 };
        },
      },
    } as any;

    await sendTextMessage(mockBot, { chatId: "100", text: "test", silent: true });
    assert.equal(capturedOpts.disable_notification, true);
  });
});
