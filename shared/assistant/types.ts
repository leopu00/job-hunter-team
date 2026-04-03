/**
 * Tipi per il bot assistente personale utente.
 *
 * Definisce richieste utente, intent classificati,
 * messaggi verso il team e configurazione assistente.
 */

// ── CONFIG ──────────────────────────────────────────────────

export interface AssistantConfig {
  /** Token bot Telegram dell'assistente personale */
  botToken: string;
  /** Nome visualizzato dell'assistente */
  name: string;
  /** Emoji/avatar dell'assistente */
  avatar: string;
  /** ID chat del proprietario (unico utente autorizzato) */
  ownerChatId: string;
  /** Sessione tmux del capitano JHT */
  captainSession: string;
  /** Timeout risposta dal team in ms (default: 5 min) */
  teamResponseTimeoutMs: number;
}

export const DEFAULT_ASSISTANT_CONFIG: Omit<AssistantConfig, "botToken" | "ownerChatId"> = {
  name: "Assistente JHT",
  avatar: "🤖",
  captainSession: "ALFA",
  teamResponseTimeoutMs: 5 * 60 * 1000,
};

// ── INTENT ──────────────────────────────────────────────────

/** Intent classificato dalla richiesta utente */
export type UserIntent =
  | { kind: "job_search"; query: string; filters?: JobSearchFilters }
  | { kind: "status_check" }
  | { kind: "list_applications" }
  | { kind: "stop_search" }
  | { kind: "update_profile"; details: string }
  | { kind: "unknown"; rawText: string };

export interface JobSearchFilters {
  role?: string;
  location?: string;
  remote?: boolean;
  salary?: string;
  keywords?: string[];
}

// ── RICHIESTE E RISPOSTE ────────────────────────────────────

/** Richiesta dal bot assistente verso il team JHT */
export interface TeamRequest {
  id: string;
  intent: UserIntent;
  userId: string;
  timestamp: number;
  status: "pending" | "dispatched" | "completed" | "timeout" | "error";
}

/** Risposta dal team JHT verso il bot assistente */
export interface TeamResponse {
  requestId: string;
  message: string;
  data?: Record<string, unknown>;
  timestamp: number;
}

/** Messaggio interno per comunicazione col capitano */
export interface CaptainMessage {
  from: string;
  intent: UserIntent;
  requestId: string;
  timestamp: number;
}

// ── EVENTI ──────────────────────────────────────────────────

export type AssistantEvent =
  | { type: "request_received"; request: TeamRequest }
  | { type: "request_dispatched"; requestId: string }
  | { type: "response_received"; response: TeamResponse }
  | { type: "request_timeout"; requestId: string }
  | { type: "error"; requestId: string; error: string };

export type AssistantEventHandler = (event: AssistantEvent) => void;

// ── STATO ───────────────────────────────────────────────────

export interface AssistantStatus {
  running: boolean;
  botUsername?: string;
  ownerChatId: string;
  pendingRequests: number;
  totalRequests: number;
  startedAt?: number;
}
