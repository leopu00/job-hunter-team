/**
 * Lista canonica dei provider AI.
 *
 * Viveva dentro `app/api/credentials/route.ts`, ma `/api/setup` ne teneva una
 * copia a mano — con "kimi" duplicato e i provider OAuth mancanti. Due liste
 * che devono restare uguali sono una lista sola scritta due volte: sta qui,
 * in `lib/`, perché un `route.ts` non può esportare simboli che non siano
 * handler HTTP senza far arrabbiare il type-checker di Next.
 */

/** Provider con credenziale a chiave API (salvata come `<provider>.json`). */
export const API_KEY_PROVIDERS = ["claude", "openai", "kimi"] as const;

/** Provider con credenziale OAuth (abbonamento, niente chiave da incollare). */
export const OAUTH_PROVIDERS = ["chatgpt_pro", "claude_max"] as const;

export const ALL_PROVIDERS = [
  ...API_KEY_PROVIDERS,
  ...OAUTH_PROVIDERS,
] as const;

export type Provider = (typeof ALL_PROVIDERS)[number];

/**
 * Nomi validi per il runtime del team.
 *
 * Non confondere i provider di credenziali OAuth (`chatgpt_pro`,
 * `claude_max`) con un runtime: il processo da avviare resta codex/claude.
 * `anthropic` e `codex` sono alias storici ancora scritti da alcune config.
 */
export const ACTIVE_PROVIDER_ALIASES = ["anthropic", "codex"] as const;
export const ACTIVE_PROVIDERS = [
  ...API_KEY_PROVIDERS,
  ...ACTIVE_PROVIDER_ALIASES,
] as const;

export type ActiveProvider = (typeof ACTIVE_PROVIDERS)[number];
