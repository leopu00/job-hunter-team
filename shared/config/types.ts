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

export interface LocalScorerConfig {
  enabled: boolean;
  backend: "openai_compatible";
  /** Ollama/llama.cpp endpoint reachable from the runtime container. */
  base_url: string;
  model: string;
  /** `shadow` never changes the queue; `write` persists validated scores. */
  mode: "shadow" | "write";
  timeout_seconds: number;
  poll_seconds: number;
}

export interface TeamSettings {
  working_hours?: WorkingHoursConfig;
  local_scorer?: LocalScorerConfig;
}

// --- Candidature (CLOSER) ---

/**
 * Il consenso generale dell'utente a farsi candidare dal team [JHT-CLOSER].
 *
 * È la PRIMA di due condizioni, non l'unica: senza anche il flag su quella
 * posizione (`positions.apply_requested`) non parte niente. Entrambe
 * fail-closed — blocco assente = disattivato, e il gate che le applica
 * (`shared/skills/apply_gate.py`) rifiuta invece di indovinare.
 *
 * ⚠️ `mode: "authorised"` è il comportamento di consegna, non un'opzione
 * avanzata: il flag per-posizione È l'autorizzazione a inviare, e il CLOSER
 * non si ferma su un secondo bottone (decisione dell'operatore, 2026-09-12).
 * `dry_run` esiste per collaudare una ricetta ATS nuova senza spedire davvero:
 * è diagnostica nostra, non il percorso dell'utente.
 */
export type AutoApplyMode = "authorised" | "dry_run";

export interface AutoApplyConfig {
  /** Default `false`. Nessun consenso = il CLOSER non viene nemmeno spawnato. */
  enabled: boolean;
  /** Tetto giornaliero di candidature inviate, se l'utente ne vuole uno. Assente o null = nessun tetto. */
  max_per_day?: number | null;
  mode: AutoApplyMode;
}

export interface ApplicationsConfig {
  auto_apply?: AutoApplyConfig;
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
  /** Consenso alle candidature automatiche (CLOSER). Assente = disattivato. */
  applications?: ApplicationsConfig;
  /** Path assoluto alla workspace JHT */
  workspace: string;
}
