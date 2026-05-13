/**
 * JHT Config — Schema Zod per validazione jht.config.json
 *
 * Validazione centralizzata con regole condizionali:
 * - api_key obbligatoria se auth_method = "api_key"
 * - subscription opzionale (l'auth vera e' OAuth device-flow del CLI provider)
 */

import { z } from "zod";

// --- Sub-schemas ---

export const SubscriptionSchema = z.object({
  email: z.string().email("Email non valida").optional(),
  session_token: z.string().optional(),
});

export const AIProviderSchema = z
  .object({
    name: z.enum(["claude", "openai", "kimi"]),
    auth_method: z.enum(["api_key", "subscription"]),
    api_key: z.string().optional(),
    subscription: SubscriptionSchema.optional(),
    model: z.string().optional(),
  })
  .refine(
    (p) => {
      if (p.auth_method === "api_key") return !!p.api_key;
      return true;
    },
    { message: "api_key obbligatoria quando auth_method = 'api_key'", path: ["api_key"] }
  );
  // Niente refine su subscription: per auth_method = "subscription" l'auth
  // viene fatta dal CLI provider (claude/codex/kimi) via OAuth device flow.
  // I token vivono fuori dal config (~/.claude/, ecc), quindi 'subscription'
  // qui e' opzionale e per lo piu' vuoto.

// Singolo bot Telegram (decisione 2026-05-13 rev2): un bot per agente
// user-facing → 3 bot obbligatori (assistente, capitano, mentor).
export const TelegramBotSchema = z.object({
  bot_token: z.string().min(1, "bot_token obbligatorio"),
  chat_id: z.string().optional(),
});

export const TelegramBotsSchema = z.object({
  assistente: TelegramBotSchema,
  capitano: TelegramBotSchema,
  mentor: TelegramBotSchema,
});

export const TelegramChannelSchema = z.object({
  bots: TelegramBotsSchema,
});

export const ChannelsSchema = z.object({
  telegram: TelegramChannelSchema.optional(),
});

// --- Root schema ---

export const JHTConfigSchema = z
  .object({
    version: z.number().int().positive().default(1),
    active_provider: z.enum(["claude", "openai", "kimi"]),
    providers: z.object({
      claude: AIProviderSchema.optional(),
      openai: AIProviderSchema.optional(),
      kimi: AIProviderSchema.optional(),
    }),
    channels: ChannelsSchema.default({}),
    workspace: z.string().min(1, "workspace obbligatorio"),
  })
  .refine(
    (cfg) => {
      const activeKey = cfg.active_provider;
      return !!cfg.providers[activeKey];
    },
    {
      message: "Il provider attivo deve avere una configurazione in 'providers'",
      path: ["active_provider"],
    }
  );

// --- Tipi derivati dallo schema ---

export type JHTConfigInput = z.input<typeof JHTConfigSchema>;
export type JHTConfigParsed = z.output<typeof JHTConfigSchema>;

// --- Utility di validazione ---

export function validateConfig(data: unknown) {
  return JHTConfigSchema.safeParse(data);
}
