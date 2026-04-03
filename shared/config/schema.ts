/**
 * JHT Config — Schema Zod per validazione jht.config.json
 *
 * Validazione centralizzata con regole condizionali:
 * - api_key obbligatoria se auth_method = "api_key"
 * - subscription obbligatorio se auth_method = "subscription"
 */

import { z } from "zod";

// --- Sub-schemas ---

export const SubscriptionSchema = z.object({
  email: z.string().email("Email non valida"),
  session_token: z.string().optional(),
});

export const AIProviderSchema = z
  .object({
    name: z.enum(["claude", "openai", "minimax"]),
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
  )
  .refine(
    (p) => {
      if (p.auth_method === "subscription") return !!p.subscription;
      return true;
    },
    { message: "subscription obbligatorio quando auth_method = 'subscription'", path: ["subscription"] }
  );

export const TelegramChannelSchema = z.object({
  bot_token: z.string().min(1, "bot_token obbligatorio"),
  chat_id: z.string().optional(),
  webhook_url: z.string().url("URL webhook non valido").optional(),
});

export const ChannelsSchema = z.object({
  telegram: TelegramChannelSchema.optional(),
});

// --- Root schema ---

export const JHTConfigSchema = z
  .object({
    version: z.number().int().positive().default(1),
    active_provider: z.enum(["claude", "openai", "minimax"]),
    providers: z.object({
      claude: AIProviderSchema.optional(),
      openai: AIProviderSchema.optional(),
      minimax: AIProviderSchema.optional(),
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
