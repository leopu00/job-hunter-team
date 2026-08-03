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
    {
      message: "api_key obbligatoria quando auth_method = 'api_key'",
      path: ["api_key"],
    },
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

// Working hours (decisione 2026-05-13 sera, bot-telegram.md § 9).
// Default = team 24/7. Quando `windows` e' non vuoto, fuori finestra
// il pacing-bridge non emette tick al Capitano e jht-notify-user non
// fa push Telegram (la riga resta in pending_user_messages → dashboard).
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

// Ore minime per blocco di lavoro giornaliero (decisione utente 2026-06-19):
// gli orari devono essere CONTIGUI (un solo blocco per giorno) e durare
// almeno MIN_WINDOW_HOURS. Default proposto dalla UI/wizard = 9h (09:00-18:00).
export const MIN_WINDOW_HOURS = 4;

// Durata in ore di una finestra HH:MM→HH:MM. Se end <= start la finestra
// attraversa la mezzanotte (es. 22:00→07:00 = 9h) → aggiungiamo 24h. I refine
// girano solo dopo che il regex HH:MM ha validato start/end, quindi qui i
// valori sono sempre ben formati.
export function windowDurationHours(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let d = eh + em / 60 - (sh + sm / 60);
  if (d <= 0) d += 24; // wrap mezzanotte
  return d;
}

export const WorkingHoursWindowSchema = z
  .object({
    days: z.array(z.enum(WEEKDAYS)).min(1, "almeno un giorno"),
    start: z.string().regex(HHMM_RE, "formato HH:MM (24h)"),
    end: z.string().regex(HHMM_RE, "formato HH:MM (24h)"),
  })
  // inizio = fine sarebbe ambiguo (0h o 24h): vietato.
  .refine((w) => w.start !== w.end, {
    message: "inizio e fine non possono coincidere",
    path: ["end"],
  })
  // min 4h per blocco (wrap mezzanotte incluso).
  .refine((w) => windowDurationHours(w.start, w.end) >= MIN_WINDOW_HOURS, {
    message: `ogni blocco di lavoro deve durare almeno ${MIN_WINDOW_HOURS} ore`,
    path: ["end"],
  });

export const WorkingHoursSchema = z
  .object({
    // IANA tz name (es. "Europe/Rome"). Default UTC perche' funziona sempre,
    // anche se la UI di onboarding dovrebbe proporre la tz locale dell'utente.
    timezone: z.string().min(1).default("UTC"),
    // Array vuoto = 24/7. Wrap-around mezzanotte supportato (start > end).
    // Ogni finestra e' UN blocco contiguo; il refine sotto garantisce che ogni
    // giorno compaia in AL PIU' una finestra → un solo blocco contiguo/giorno.
    windows: z.array(WorkingHoursWindowSchema).default([]),
  })
  // Contiguita': nessun giorno puo' apparire in piu' finestre (= niente blocchi
  // sparsi sullo stesso giorno, es. 1h pomeriggio + 2h sera).
  .refine(
    (wh) => {
      const seen = new Set<string>();
      for (const w of wh.windows ?? []) {
        for (const d of w.days ?? []) {
          if (seen.has(d)) return false;
          seen.add(d);
        }
      }
      return true;
    },
    {
      message:
        "ogni giorno puo' avere UN solo blocco di lavoro contiguo (niente finestre multiple sullo stesso giorno)",
      path: ["windows"],
    },
  );

export const LocalScorerSchema = z.object({
  enabled: z.boolean().default(false),
  backend: z.literal("openai_compatible").default("openai_compatible"),
  base_url: z
    .string()
    .url()
    .refine((value) => {
      try {
        const url = new URL(value);
        return (
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]", "host.docker.internal"].includes(
            url.hostname,
          )
        );
      } catch {
        return false;
      }
    }, "base_url deve puntare a un endpoint HTTP locale"),
  model: z.string().min(1, "model obbligatorio"),
  mode: z.enum(["shadow", "write"]).default("shadow"),
  timeout_seconds: z.number().int().min(1).max(600).default(120),
  poll_seconds: z.number().int().min(5).max(3600).default(120),
});

export const TeamSettingsSchema = z.object({
  working_hours: WorkingHoursSchema.optional(),
  local_scorer: LocalScorerSchema.optional(),
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
    team: TeamSettingsSchema.optional(),
    workspace: z.string().min(1, "workspace obbligatorio"),
  })
  .refine(
    (cfg) => {
      const activeKey = cfg.active_provider;
      return !!cfg.providers[activeKey];
    },
    {
      message:
        "Il provider attivo deve avere una configurazione in 'providers'",
      path: ["active_provider"],
    },
  );

// --- Tipi derivati dallo schema ---

export type JHTConfigInput = z.input<typeof JHTConfigSchema>;
export type JHTConfigParsed = z.output<typeof JHTConfigSchema>;

// --- Utility di validazione ---

export function validateConfig(data: unknown) {
  return JHTConfigSchema.safeParse(data);
}
