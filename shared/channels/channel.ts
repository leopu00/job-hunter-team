/**
 * JHT Channels — Interfaccia base Channel
 *
 * Astrazione unificata per tutti i canali di comunicazione.
 * Ogni canale (web, CLI, Telegram) implementa questa interfaccia.
 */

// --- Channel IDs ---

export const CHANNEL_IDS = ['web', 'cli', 'telegram'] as const;
export type ChannelId = (typeof CHANNEL_IDS)[number];

// --- Message Types ---

export type MessageDirection = 'inbound' | 'outbound';

export interface ChannelMessage {
  id: string;
  channelId: ChannelId;
  direction: MessageDirection;
  text: string;
  /** Mittente (utente o sistema) */
  sender: string;
  /** Destinatario */
  recipient?: string;
  /** Timestamp epoch ms */
  timestamp: number;
  /** Metadati specifici del canale */
  meta?: Record<string, unknown>;
}

// --- Channel Capabilities ---

export interface ChannelCapabilities {
  /** Supporta markdown nella formattazione */
  markdown: boolean;
  /** Supporta messaggi in streaming (chunk progressivi) */
  streaming: boolean;
  /** Supporta invio file/allegati */
  attachments: boolean;
  /** Supporta notifiche push */
  push: boolean;
}

// --- Channel Meta ---

export interface ChannelMeta {
  id: ChannelId;
  label: string;
  description: string;
  capabilities: ChannelCapabilities;
}

// --- Message Handler ---

export type MessageHandler = (message: ChannelMessage) => Promise<void>;

// --- Channel Interface ---

export interface Channel {
  /** Identificativo univoco del canale */
  readonly id: ChannelId;
  /** Metadati del canale */
  readonly meta: ChannelMeta;
  /** Stato connessione */
  readonly connected: boolean;

  /**
   * Inizializza e connette il canale.
   * Chiamato una volta al bootstrap.
   */
  connect(): Promise<void>;

  /**
   * Disconnette e pulisce le risorse.
   */
  disconnect(): Promise<void>;

  /**
   * Invia un messaggio in uscita attraverso il canale.
   */
  send(message: Omit<ChannelMessage, 'id' | 'channelId' | 'direction' | 'timestamp'>): Promise<ChannelMessage>;

  /**
   * Registra un handler per i messaggi in entrata.
   * Ritorna una funzione per rimuovere l'handler.
   */
  onMessage(handler: MessageHandler): () => void;
}

// --- Helpers ---

export function createMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function buildOutboundMessage(
  channelId: ChannelId,
  params: Omit<ChannelMessage, 'id' | 'channelId' | 'direction' | 'timestamp'>,
): ChannelMessage {
  return {
    id: createMessageId(),
    channelId,
    direction: 'outbound',
    timestamp: Date.now(),
    ...params,
  };
}

export function buildInboundMessage(
  channelId: ChannelId,
  params: Omit<ChannelMessage, 'id' | 'channelId' | 'direction' | 'timestamp'>,
): ChannelMessage {
  return {
    id: createMessageId(),
    channelId,
    direction: 'inbound',
    timestamp: Date.now(),
    ...params,
  };
}
