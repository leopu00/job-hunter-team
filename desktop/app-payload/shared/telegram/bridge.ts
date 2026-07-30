/**
 * Bridge bidirezionale Telegram ↔ JHT.
 *
 * Gestisce il ciclo di vita del bot, l'invio messaggi in uscita,
 * il chunking testo, e il collegamento con il sistema JHT.
 */

import { Bot } from "grammy";
import type {
  TelegramBotConfig,
  InboundHandler,
  OutboundMessage,
  SendResult,
  BridgeStatus,
} from "./types.js";
import { DEFAULT_CONFIG } from "./types.js";
import { createBot, registerMessageHandler } from "./bot.js";

// ── BRIDGE CLASS ────────────────────────────────────────────

/**
 * Bridge bidirezionale che collega Telegram al sistema JHT.
 * Gestisce avvio/stop del bot, statistiche, e invio proattivo.
 */
export class TelegramBridge {
  private bot: Bot;
  private config: TelegramBotConfig;
  private status: BridgeStatus;

  constructor(token: string, options: Partial<TelegramBotConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, token, ...options };
    this.bot = createBot(this.config);
    this.status = {
      running: false,
      mode: this.config.mode,
      messagesReceived: 0,
      messagesSent: 0,
      errors: 0,
    };
  }

  /** Avvia il bridge con l'handler per messaggi in ingresso */
  async start(onMessage: InboundHandler): Promise<void> {
    // Registra handler con contatore statistiche
    registerMessageHandler(this.bot, this.config, async (msg) => {
      this.status.messagesReceived++;
      try {
        const reply = await onMessage(msg);
        if (reply) this.status.messagesSent++;
        return reply;
      } catch (err) {
        this.status.errors++;
        console.error("[telegram-bridge] Errore handler:", err);
        return null;
      }
    });

    // Recupera info bot
    const me = await this.bot.api.getMe();
    this.status.botUsername = me.username;

    // Avvia polling o webhook
    if (this.config.mode === "polling") {
      this.bot.start({
        onStart: () => {
          this.status.running = true;
          this.status.startedAt = Date.now();
          console.log(`[telegram-bridge] Bot @${me.username} avviato (polling)`);
        },
      });
    }
    // Webhook: il server HTTP va configurato esternamente
  }

  /** Ferma il bridge */
  async stop(): Promise<void> {
    await this.bot.stop();
    this.status.running = false;
    console.log("[telegram-bridge] Bot fermato");
  }

  /** Invia un messaggio proattivo (non in risposta a un inbound) */
  async send(msg: OutboundMessage): Promise<SendResult> {
    this.status.messagesSent++;
    return sendTextMessage(this.bot, msg);
  }

  /** Restituisce lo stato corrente del bridge */
  getStatus(): BridgeStatus {
    return { ...this.status };
  }

  /** Accesso diretto al bot grammY per estensioni */
  getBot(): Bot {
    return this.bot;
  }
}

// ── MESSAGE SENDING ─────────────────────────────────────────

/**
 * Invia un messaggio testuale con chunking per il limite 4096 char.
 * Retry senza thread ID se il topic non esiste.
 */
export async function sendTextMessage(
  bot: Bot,
  msg: OutboundMessage
): Promise<SendResult> {
  const chatId = Number(msg.chatId);
  const chunks = chunkText(msg.text, 4096);
  let firstMessageId: number | undefined;

  for (const chunk of chunks) {
    try {
      const result = await bot.api.sendMessage(chatId, chunk, {
        parse_mode: msg.parseMode ?? "HTML",
        reply_to_message_id:
          firstMessageId == null ? msg.replyToMessageId : undefined,
        message_thread_id: msg.threadId,
        disable_notification: msg.silent,
        allow_sending_without_reply: true,
      });
      firstMessageId ??= result.message_id;
    } catch (err) {
      // Retry senza thread ID se il topic non esiste
      if (msg.threadId && isThreadNotFoundError(err)) {
        try {
          const result = await bot.api.sendMessage(chatId, chunk, {
            parse_mode: msg.parseMode ?? "HTML",
            reply_to_message_id:
              firstMessageId == null ? msg.replyToMessageId : undefined,
            disable_notification: msg.silent,
            allow_sending_without_reply: true,
          });
          firstMessageId ??= result.message_id;
        } catch (retryErr) {
          return { messageId: 0, chatId: msg.chatId, success: false, error: String(retryErr) };
        }
      } else {
        return { messageId: 0, chatId: msg.chatId, success: false, error: String(err) };
      }
    }
  }

  return { messageId: firstMessageId ?? 0, chatId: msg.chatId, success: true };
}

// ── UTILITIES ───────────────────────────────────────────────

/** Splitta testo rispettando il limite Telegram senza tagliare a metà parola */
function chunkText(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf("\n", limit);
    if (splitAt < limit * 0.5) splitAt = remaining.lastIndexOf(" ", limit);
    if (splitAt < limit * 0.3) splitAt = limit;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  return chunks;
}

/** Verifica se l'errore è "thread/topic not found" di Telegram */
function isThreadNotFoundError(err: unknown): boolean {
  const msg = String(err);
  return msg.includes("TOPIC_CLOSED") || msg.includes("TOPIC_DELETED");
}
