/**
 * Bot Telegram con grammY — creazione bot e handler messaggi in ingresso.
 *
 * Riceve messaggi da Telegram, li converte in InboundMessage,
 * li passa all'handler del bridge.
 */

import { Bot, type Context } from "grammy";
import { autoRetry } from "@grammyjs/auto-retry";
import { sequentialize } from "@grammyjs/runner";
import type {
  TelegramBotConfig,
  InboundMessage,
  InboundHandler,
} from "./types.js";
import { getSequentialKey } from "./types.js";
import { sendTextMessage } from "./bridge.js";

// ── BOT CREATION ────────────────────────────────────────────

/**
 * Crea e configura il bot grammY con middleware standard.
 * Pattern: throttle → sequentialize → error handler → message handler.
 */
export function createBot(config: TelegramBotConfig): Bot {
  const bot = new Bot(config.token);

  // Rate limiting automatico sulle API Telegram
  bot.api.config.use(autoRetry());

  // Serializza messaggi per chat/thread — previene race condition
  bot.use(
    sequentialize((ctx: Context) => {
      const chatId = ctx.chat?.id;
      const threadId = ctx.message?.message_thread_id;
      return chatId
        ? getSequentialKey(String(chatId), threadId)
        : undefined;
    })
  );

  // Error handler globale
  bot.catch((err) => {
    console.error("[telegram-bot] Errore non gestito:", err.message);
  });

  return bot;
}

// ── ACCESS CONTROL ──────────────────────────────────────────

/** Verifica se la chat è autorizzata */
function isChatAllowed(chatId: string, allowedChatIds: string[]): boolean {
  if (allowedChatIds.length === 0) return true;
  return allowedChatIds.includes(chatId);
}

// ── MESSAGE EXTRACTION ──────────────────────────────────────

/** Estrae InboundMessage dal contesto grammY */
function extractInboundMessage(ctx: Context): InboundMessage | null {
  const msg = ctx.message;
  if (!msg) return null;

  const text = msg.text || msg.caption || "";
  if (!text.trim()) return null;

  return {
    messageId: msg.message_id,
    chatId: String(msg.chat.id),
    senderId: String(msg.from?.id ?? "unknown"),
    senderUsername: msg.from?.username,
    text,
    chatType: msg.chat.type,
    threadId: msg.message_thread_id,
    replyToMessageId: msg.reply_to_message?.message_id,
    timestamp: msg.date * 1000,
  };
}

// ── HANDLER REGISTRATION ────────────────────────────────────

/**
 * Registra l'handler per messaggi in ingresso.
 * Flusso: Telegram → extract → access check → typing → handler → send reply.
 */
export function registerMessageHandler(
  bot: Bot,
  config: TelegramBotConfig,
  onMessage: InboundHandler
): void {
  bot.on("message", async (ctx) => {
    const inbound = extractInboundMessage(ctx);
    if (!inbound) return;

    // Access control
    if (!isChatAllowed(inbound.chatId, config.allowedChatIds)) return;

    // Typing indicator
    await ctx.api
      .sendChatAction(Number(inbound.chatId), "typing", {
        message_thread_id: inbound.threadId,
      })
      .catch(() => {});

    // Processa tramite handler del bridge
    const reply = await onMessage(inbound);
    if (!reply) return;

    // Invia risposta via bridge
    await sendTextMessage(bot, {
      ...reply,
      chatId: inbound.chatId,
      replyToMessageId: reply.replyToMessageId ?? inbound.messageId,
      threadId: inbound.threadId,
    });
  });
}
