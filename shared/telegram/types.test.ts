/**
 * Test unitari — shared/telegram/types
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSequentialKey, DEFAULT_CONFIG } from "./types.js";
import type { TelegramBotConfig, InboundMessage, OutboundMessage, BridgeStatus } from "./types.js";

describe("getSequentialKey", () => {
  it("genera chiave con solo chatId", () => {
    assert.equal(getSequentialKey("12345"), "chat:12345");
  });

  it("genera chiave con chatId e threadId", () => {
    assert.equal(getSequentialKey("12345", 42), "chat:12345:thread:42");
  });

  it("gestisce chatId numerico convertito a stringa", () => {
    assert.equal(getSequentialKey(String(99), undefined), "chat:99");
  });
});

describe("DEFAULT_CONFIG", () => {
  it("ha allowedChatIds vuoto", () => {
    assert.deepEqual(DEFAULT_CONFIG.allowedChatIds, []);
  });

  it("ha mode polling", () => {
    assert.equal(DEFAULT_CONFIG.mode, "polling");
  });

  it("ha textLimit 4096", () => {
    assert.equal(DEFAULT_CONFIG.textLimit, 4096);
  });
});

describe("InboundMessage type shape", () => {
  it("crea messaggio inbound valido", () => {
    const msg: InboundMessage = {
      messageId: 1,
      chatId: "100",
      senderId: "200",
      text: "ciao",
      chatType: "private",
      timestamp: Date.now(),
    };
    assert.equal(msg.chatType, "private");
    assert.equal(msg.senderUsername, undefined);
    assert.equal(msg.mediaPaths, undefined);
  });

  it("crea messaggio inbound con campi opzionali", () => {
    const msg: InboundMessage = {
      messageId: 2,
      chatId: "100",
      senderId: "200",
      senderUsername: "leo",
      text: "test",
      chatType: "group",
      threadId: 5,
      replyToMessageId: 1,
      mediaPaths: ["/tmp/photo.jpg"],
      timestamp: Date.now(),
    };
    assert.equal(msg.senderUsername, "leo");
    assert.equal(msg.threadId, 5);
    assert.equal(msg.mediaPaths?.length, 1);
  });
});

describe("OutboundMessage type shape", () => {
  it("crea messaggio outbound minimo", () => {
    const msg: OutboundMessage = { chatId: "100", text: "risposta" };
    assert.equal(msg.parseMode, undefined);
    assert.equal(msg.silent, undefined);
  });

  it("crea messaggio outbound completo", () => {
    const msg: OutboundMessage = {
      chatId: "100",
      text: "risposta",
      threadId: 5,
      replyToMessageId: 1,
      parseMode: "HTML",
      silent: true,
    };
    assert.equal(msg.parseMode, "HTML");
    assert.equal(msg.silent, true);
  });
});

describe("BridgeStatus type shape", () => {
  it("crea status iniziale", () => {
    const status: BridgeStatus = {
      running: false,
      mode: "polling",
      messagesReceived: 0,
      messagesSent: 0,
      errors: 0,
    };
    assert.equal(status.running, false);
    assert.equal(status.botUsername, undefined);
    assert.equal(status.startedAt, undefined);
  });
});

describe("TelegramBotConfig type shape", () => {
  it("crea config completa da DEFAULT_CONFIG", () => {
    const config: TelegramBotConfig = { ...DEFAULT_CONFIG, token: "test:token" };
    assert.equal(config.token, "test:token");
    assert.equal(config.mode, "polling");
    assert.equal(config.textLimit, 4096);
  });

  it("override mode a webhook con porta", () => {
    const config: TelegramBotConfig = {
      ...DEFAULT_CONFIG,
      token: "test:token",
      mode: "webhook",
      webhookPort: 8443,
      webhookUrl: "https://example.com/webhook",
    };
    assert.equal(config.mode, "webhook");
    assert.equal(config.webhookPort, 8443);
  });
});
