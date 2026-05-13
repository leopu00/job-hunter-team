/**
 * JHT Config — Tipi TypeScript per jht.config.json
 *
 * File di configurazione centralizzato in ~/.jht/jht.config.json
 * Supporta multipli provider AI, autenticazione flessibile e canali.
 */

// --- Provider AI ---

export type AIProviderName = "claude" | "openai" | "kimi";

export type AuthMethod = "api_key" | "subscription";

export interface AIProviderConfig {
  name: AIProviderName;
  auth_method: AuthMethod;
  /** Obbligatorio se auth_method = "api_key" (plaintext legacy) */
  api_key?: string;
  /** SecretRef per API key (env/file/exec) — preferito a api_key plaintext */
  api_key_ref?: import("./secret-ref").SecretRef;
  /** Obbligatorio se auth_method = "subscription" */
  subscription?: SubscriptionConfig;
  /** Modello da usare (es. "claude-opus-4-6", "gpt-4o", "kimi-k2-0905-preview") */
  model?: string;
}

export interface SubscriptionConfig {
  email: string;
  /** Token di sessione o cookie — gestito dal wizard al login */
  session_token?: string;
}

// --- Canali ---

export type ChannelName = "telegram";

/** Ruoli user-facing che hanno un bot Telegram dedicato (decisione 2026-05-13 rev2). */
export type TelegramBotRole = "assistente" | "capitano" | "mentor";

export interface TelegramBotConfig {
  bot_token: string;
  chat_id?: string;
}

export interface TelegramChannelConfig {
  bots: Record<TelegramBotRole, TelegramBotConfig>;
}

export interface ChannelsConfig {
  telegram?: TelegramChannelConfig;
}

// --- Team settings ---

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

/**
 * Finestra di lavoro. `start` e `end` in formato "HH:MM" (24h) nella
 * timezone del config team. Wrap-around mezzanotte supportato: se
 * `start > end` la finestra si estende al giorno successivo (es. start
 * 22:00, end 06:00 = mon 22:00 → tue 06:00).
 */
export interface WorkingHoursWindow {
  days: Weekday[];
  start: string;
  end: string;
}

/**
 * Working hours del team (decisione 2026-05-13, bot-telegram.md § 9).
 * Default = team 24/7 (campo assente o `windows` vuoto). Quando configurato,
 * fuori finestra il pacing-bridge non emette tick al Capitano e
 * jht-notify-user salta il push Telegram (DB-only, dashboard prende il
 * messaggio).
 */
export interface WorkingHoursConfig {
  /** IANA tz name (es. "Europe/Rome"). Default "UTC". */
  timezone: string;
  /** Array vuoto = 24/7. */
  windows: WorkingHoursWindow[];
}

export interface TeamSettings {
  working_hours?: WorkingHoursConfig;
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
  /** Impostazioni team-wide (working hours, ecc.) */
  team?: TeamSettings;
  /** Path assoluto alla workspace JHT */
  workspace: string;
}
