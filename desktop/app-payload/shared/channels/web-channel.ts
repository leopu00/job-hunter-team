/**
 * JHT Channels — Web Channel (API HTTP)
 *
 * Canale per interazione via web/API. I messaggi transitano
 * attraverso endpoint HTTP. Supporta markdown e streaming.
 */
import type { Channel, ChannelMeta, ChannelMessage, MessageHandler } from './channel.js';
import { buildInboundMessage, buildOutboundMessage } from './channel.js';

const WEB_META: ChannelMeta = {
  id: 'web',
  label: 'Web',
  description: 'Interfaccia web — messaggi via API HTTP',
  capabilities: {
    markdown: true,
    streaming: true,
    attachments: true,
    push: true,
  },
};

/** Coda messaggi in uscita per polling o SSE */
type OutboundQueue = {
  messages: ChannelMessage[];
  maxSize: number;
};

export class WebChannel implements Channel {
  readonly id = 'web' as const;
  readonly meta = WEB_META;

  #connected = false;
  #handlers: Set<MessageHandler> = new Set();
  #outbound: OutboundQueue;

  constructor(opts?: { maxQueueSize?: number }) {
    this.#outbound = {
      messages: [],
      maxSize: opts?.maxQueueSize ?? 100,
    };
  }

  get connected(): boolean {
    return this.#connected;
  }

  async connect(): Promise<void> {
    this.#connected = true;
  }

  async disconnect(): Promise<void> {
    this.#connected = false;
    this.#handlers.clear();
    this.#outbound.messages = [];
  }

  async send(
    params: Omit<ChannelMessage, 'id' | 'channelId' | 'direction' | 'timestamp'>,
  ): Promise<ChannelMessage> {
    const message = buildOutboundMessage('web', params);

    this.#outbound.messages.push(message);
    if (this.#outbound.messages.length > this.#outbound.maxSize) {
      this.#outbound.messages.shift();
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
   * Riceve un messaggio dall'API HTTP (es. POST /api/chat).
   * Invoca tutti gli handler registrati.
   */
  async receiveFromAPI(params: {
    text: string;
    sender: string;
    meta?: Record<string, unknown>;
  }): Promise<ChannelMessage> {
    const message = buildInboundMessage('web', {
      text: params.text,
      sender: params.sender,
      meta: params.meta,
    });

    for (const handler of this.#handlers) {
      await handler(message);
    }

    return message;
  }

  /**
   * Recupera i messaggi in uscita (per polling).
   * Opzionale: svuota la coda dopo il recupero.
   */
  drainOutbound(opts?: { clear?: boolean }): ChannelMessage[] {
    const messages = [...this.#outbound.messages];
    if (opts?.clear !== false) {
      this.#outbound.messages = [];
    }
    return messages;
  }

  /**
   * Recupera messaggi in uscita dopo un certo timestamp.
   */
  getOutboundSince(sinceMs: number): ChannelMessage[] {
    return this.#outbound.messages.filter((m) => m.timestamp > sinceMs);
  }

  /** Numero di messaggi in coda */
  get queueSize(): number {
    return this.#outbound.messages.length;
  }
}
