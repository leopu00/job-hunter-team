/**
 * Tipi per il bridge Telegram bidirezionale.
 *
 * Definisce le interfacce per messaggi in ingresso/uscita,
 * configurazione bot, e contesto conversazione.
 */

// ── CONFIG ──────────────────────────────────────────────────

export interface TelegramBotConfig {
  /** Token del bot Telegram (da BotFather) */
  token: string;
  /** Chat ID autorizzati (whitelist). Vuoto = tutti ammessi */
  allowedChatIds: string[];
  /** Modalità polling o webhook */
  mode: "polling" | "webhook";
  /** Porta webhook (se mode = webhook) */
  webhookPort?: number;
  /** URL pubblico per webhook */
  webhookUrl?: string;
  /** Limite caratteri per messaggio Telegram */
  textLimit: number;
}

export const DEFAULT_CONFIG: Omit<TelegramBotConfig, "token"> = {
  allowedChatIds: [],
  mode: "polling",
  textLimit: 4096,
};

// ── MESSAGGI ────────────────────────────────────────────────

/** Messaggio in ingresso da Telegram verso il sistema JHT */
export interface InboundMessage {
  /** ID univoco del messaggio Telegram */
  messageId: number;
  /** ID della chat */
  chatId: string;
  /** ID del mittente */
  senderId: string;
  /** Username del mittente (senza @) */
  senderUsername?: string;
  /** Testo del messaggio */
  text: string;
  /** Tipo di chat */
  chatType: "private" | "group" | "supergroup" | "channel";
  /** Thread ID per forum/topic */
  threadId?: number;
  /** ID messaggio a cui si risponde */
  replyToMessageId?: number;
  /** Percorsi media allegati (foto, documenti) */
  mediaPaths?: string[];
  /** Timestamp ricezione */
  timestamp: number;
}

/** Messaggio in uscita dal sistema JHT verso Telegram */
export interface OutboundMessage {
  /** Chat ID destinazione */
  chatId: string;
  /** Testo (Markdown) */
  text: string;
  /** Thread ID per forum/topic */
  threadId?: number;
  /** ID messaggio a cui rispondere */
  replyToMessageId?: number;
  /** Modalità parse del testo */
  parseMode?: "HTML" | "MarkdownV2";
  /** Disabilita notifica */
  silent?: boolean;
}

// ── BRIDGE ──────────────────────────────────────────────────

/** Handler per messaggi in ingresso — implementato dal sistema JHT */
export type InboundHandler = (message: InboundMessage) => Promise<OutboundMessage | null>;

/** Risultato invio messaggio */
export interface SendResult {
  messageId: number;
  chatId: string;
  success: boolean;
  error?: string;
}

/** Stato del bridge */
export interface BridgeStatus {
  running: boolean;
  mode: "polling" | "webhook";
  botUsername?: string;
  startedAt?: number;
  messagesReceived: number;
  messagesSent: number;
  errors: number;
}

// ── SEQUENTIALIZE ───────────────────────────────────────────

/** Chiave per serializzazione messaggi per chat/thread */
export function getSequentialKey(chatId: string | number, threadId?: number): string {
  const base = `chat:${chatId}`;
  return threadId ? `${base}:thread:${threadId}` : base;
}
