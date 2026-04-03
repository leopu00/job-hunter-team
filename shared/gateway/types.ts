/**
 * Gateway — Tipi core per il sistema di messaggistica JHT.
 *
 * Il gateway connette canali (web, Telegram, CLI) ai provider AI,
 * gestendo routing, middleware e ciclo di vita dei messaggi.
 */

// --- Canali ---

export type ChannelId = "web" | "telegram" | "cli";

export interface ChannelStatus {
  id: ChannelId;
  connected: boolean;
  lastActivity?: Date;
  error?: string;
}

// --- Messaggi ---

export type MessageRole = "user" | "assistant" | "system";

export interface GatewayMessage {
  id: string;
  channel: ChannelId;
  role: MessageRole;
  content: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
  /** ID sessione per raggruppare messaggi in conversazione */
  sessionId?: string;
  /** File allegati al messaggio */
  attachments?: Attachment[];
}

export interface Attachment {
  filename: string;
  mimeType: string;
  /** Contenuto base64 o path locale */
  data: string;
}

// --- Risposte ---

export interface GatewayResponse {
  id: string;
  messageId: string;
  content: string;
  role: "assistant";
  timestamp: Date;
  /** Token usati per questa risposta */
  usage?: TokenUsage;
  /** Se la risposta e' in streaming */
  streaming: boolean;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

// --- Middleware ---

export interface MiddlewareContext {
  message: GatewayMessage;
  response?: GatewayResponse;
  metadata: Record<string, unknown>;
  /** Se true, il messaggio non viene inoltrato al provider */
  aborted: boolean;
  /** Motivo dell'abort */
  abortReason?: string;
}

export type MiddlewarePhase = "pre" | "post";

export interface MiddlewareDescriptor {
  name: string;
  phase: MiddlewarePhase;
  priority: number;
  handler: (ctx: MiddlewareContext) => Promise<MiddlewareContext>;
}

// --- Gateway Config ---

export interface GatewayConfig {
  /** Porta HTTP del gateway */
  port: number;
  /** Canali abilitati */
  channels: ChannelId[];
  /** Timeout richiesta AI in ms */
  requestTimeoutMs: number;
  /** Max messaggi in coda */
  maxQueueSize: number;
}

export const DEFAULT_GATEWAY_CONFIG: GatewayConfig = {
  port: 18789,
  channels: ["web", "cli"],
  requestTimeoutMs: 120_000,
  maxQueueSize: 100,
};

// --- Eventi ---

export type GatewayEventType =
  | "message.received"
  | "message.routed"
  | "response.started"
  | "response.completed"
  | "channel.connected"
  | "channel.disconnected"
  | "error";

export interface GatewayEvent {
  type: GatewayEventType;
  timestamp: Date;
  data: Record<string, unknown>;
}

export type GatewayEventHandler = (event: GatewayEvent) => void;
