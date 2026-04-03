/**
 * JHT Channels — Telegram Channel
 *
 * Adattatore per il bridge Telegram. Si connette al bot via
 * telegram-bridge/ per inviare e ricevere messaggi.
 * Supporta markdown (HTML Telegram) e allegati.
 */
import type { Channel, ChannelMeta, ChannelMessage, MessageHandler } from './channel.js';
import { buildInboundMessage, buildOutboundMessage } from './channel.js';

const TELEGRAM_META: ChannelMeta = {
  id: 'telegram',
  label: 'Telegram',
  description: 'Bot Telegram — messaggi via Telegram Bot API',
  capabilities: {
    markdown: true,
    streaming: false,
    attachments: true,
    push: true,
  },
};

/** Callback per invio messaggi al bot Telegram */
export type TelegramSendFn = (params: {
  chatId: string;
  text: string;
  parseMode?: 'HTML' | 'MarkdownV2';
}) => Promise<void>;

export class TelegramChannel implements Channel {
  readonly id = 'telegram' as const;
  readonly meta = TELEGRAM_META;

  #connected = false;
  #handlers: Set<MessageHandler> = new Set();
  #chatId: string;
  #sendFn: TelegramSendFn | null;

  constructor(opts: { chatId: string; sendFn?: TelegramSendFn }) {
    this.#chatId = opts.chatId;
    this.#sendFn = opts.sendFn ?? null;
  }

  get connected(): boolean {
    return this.#connected;
  }

  async connect(): Promise<void> {
    if (!this.#chatId) {
      throw new Error('Telegram chat_id non configurato');
    }
    this.#connected = true;
  }

  async disconnect(): Promise<void> {
    this.#connected = false;
    this.#handlers.clear();
  }

  async send(
    params: Omit<ChannelMessage, 'id' | 'channelId' | 'direction' | 'timestamp'>,
  ): Promise<ChannelMessage> {
    const message = buildOutboundMessage('telegram', params);

    if (this.#sendFn) {
      await this.#sendFn({
        chatId: this.#chatId,
        text: message.text,
        parseMode: 'HTML',
      });
    }

    return message;
  }

  onMessage(handler: MessageHandler): () => void {
    this.#handlers.add(handler);
    return () => {
      this.#handlers.delete(handler);
    };
  }

  /**
   * Riceve un messaggio dal webhook/polling del bot Telegram.
   * Chiamato da telegram-bridge quando arriva un messaggio.
   */
  async receiveFromBot(params: {
    text: string;
    sender: string;
    chatId: string;
    messageId?: number;
    meta?: Record<string, unknown>;
  }): Promise<ChannelMessage> {
    const message = buildInboundMessage('telegram', {
      text: params.text,
      sender: params.sender,
      meta: {
        chatId: params.chatId,
        messageId: params.messageId,
        ...params.meta,
      },
    });

    for (const handler of this.#handlers) {
      await handler(message);
    }

    return message;
  }

  /** Aggiorna la funzione di invio (per lazy init del bot) */
  setSendFn(fn: TelegramSendFn): void {
    this.#sendFn = fn;
  }

  /** Aggiorna il chat ID di destinazione */
  setChatId(chatId: string): void {
    this.#chatId = chatId;
  }

  get chatId(): string {
    return this.#chatId;
  }
}
