/**
 * JHT Config — Tipi TypeScript per jht.config.json
 *
 * File di configurazione centralizzato in ~/.jht/jht.config.json
 * Supporta multipli provider AI, autenticazione flessibile e canali.
 */

// --- Provider AI ---

export type AIProviderName = "claude" | "openai" | "minimax";

export type AuthMethod = "api_key" | "subscription";

export interface AIProviderConfig {
  name: AIProviderName;
  auth_method: AuthMethod;
  /** Obbligatorio se auth_method = "api_key" */
  api_key?: string;
  /** Obbligatorio se auth_method = "subscription" */
  subscription?: SubscriptionConfig;
  /** Modello da usare (es. "claude-opus-4-6", "gpt-4o", "minimax-01") */
  model?: string;
}

export interface SubscriptionConfig {
  email: string;
  /** Token di sessione o cookie — gestito dal wizard al login */
  session_token?: string;
}

// --- Canali ---

export type ChannelName = "telegram";

export interface TelegramChannelConfig {
  bot_token: string;
  chat_id?: string;
  /** Webhook URL per ricevere messaggi */
  webhook_url?: string;
}

export interface ChannelsConfig {
  telegram?: TelegramChannelConfig;
}

// --- Config Root ---

export interface JHTConfig {
  /** Versione dello schema config (per migrazioni future) */
  version: number;
  /** Provider AI attivo */
  active_provider: AIProviderName;
  /** Configurazione per ciascun provider */
  providers: Partial<Record<AIProviderName, AIProviderConfig>>;
  /** Canali di comunicazione */
  channels: ChannelsConfig;
  /** Path assoluto alla workspace JHT */
  workspace: string;
}
