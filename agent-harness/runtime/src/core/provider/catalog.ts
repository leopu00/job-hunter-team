/**
 * Model profiles.
 *
 * Capabilities and prices are declared, never inferred from a model name.
 * A model absent from this table is not refused — it
 * must supply its pricing through configuration, because a run whose cost
 * cannot be computed cannot be capped, and an uncappable live run is refused.
 *
 * Prices are USD per million tokens at standard (non-batch) rates, first-party
 * API. Sources and dates are per block below. They go stale: the catalog exists
 * to cap a local run, not to be an invoice.
 */

import type { ModelCapabilities, ModelProfile, ProviderId } from "./port.ts";
import type { Pricing } from "../usage.ts";

const TOOL_MODEL: ModelCapabilities = { toolCalling: true, structuredOutput: true, webSearch: false };
/** First-party OpenAI and Anthropic models: both providers run web search server-side. */
const SEARCH_MODEL: ModelCapabilities = { ...TOOL_MODEL, webSearch: true };

/**
 * Output tokens requested when nothing says otherwise. An interview turn is a
 * few hundred; this is generous and safely under every model we target. It is
 * our policy, not a claim about any model's ceiling.
 */
const DEFAULT_MAX_OUTPUT_TOKENS = 4_096;

interface CatalogEntry {
  providerId: ProviderId;
  capabilities: ModelCapabilities;
  pricing: Pricing;
}

/**
 * Web search on a reasoning model: $10 per 1,000 calls, plus the search
 * content tokens billed at the model's input price. developers.openai.com
 * /api/docs/pricing and /docs/guides/tools-web-search, checked from the VPS
 * on 2026-09-19 for gpt-5-mini and gpt-5.6-luna (agents-hq/piani/
 * web-search-prezzi-vps-res.txt); the other models carry the same rate from
 * the 2026-09-13 check. (The $25 per 1,000 rate is for non-reasoning models.)
 */
const WEB_SEARCH_PER_CALL_USD = 0.01;

function usd(
  inputPerMTokUsd: number,
  outputPerMTokUsd: number,
  webSearchPerCallUsd = WEB_SEARCH_PER_CALL_USD,
  cacheWritePerMTokUsd?: number,
): Pricing {
  return {
    inputPerMTokUsd,
    outputPerMTokUsd,
    webSearchPerCallUsd,
    ...(cacheWritePerMTokUsd === undefined ? {} : { cacheWritePerMTokUsd }),
  };
}

const CATALOG: Record<string, CatalogEntry> = {
  // OpenAI — the models and prices of the harness plan (PIANO-HARNESS-API,
  // 2026-09-19), which match developers.openai.com/api/docs/pricing as checked
  // 2026-09-12. The API budget is OpenAI's, so only OpenAI is catalogued: any
  // other model runs live only with an explicit JHT_API_PRICE_* override.
  // Cheapest first; pick the cheapest one that holds the role.
  // luna and mini: developers.openai.com/api/docs/pricing, standard tier, reread
  // from the VPS and here on 2026-09-19 (agents-hq/piani/web-search-prezzi-vps-res.txt).
  // The page gives no threshold between short and long context, so luna is
  // priced at its long-context rates, the higher ones: input 0.40 (short 0.20),
  // output 1.80 (short 1.20), cache writes 0.50 (short 0.25), on top of input,
  // as the key proxy charges them. gpt-5-mini has no long-context or
  // cache-write price on the page (dashes): its short rates stand, and a cache
  // write is charged at twice its input price, 0.50, as the proxy does.
  // Search fee: see WEB_SEARCH_PER_CALL_USD, stated rather than defaulted.
  "gpt-5.6-luna": { providerId: "openai", capabilities: SEARCH_MODEL, pricing: usd(0.4, 1.8, 0.01, 0.5) },
  "gpt-5-mini": { providerId: "openai", capabilities: SEARCH_MODEL, pricing: usd(0.25, 2, 0.01, 0.5) },
  "gpt-5": { providerId: "openai", capabilities: SEARCH_MODEL, pricing: usd(1.25, 10) },
  "gpt-5.6-terra": { providerId: "openai", capabilities: SEARCH_MODEL, pricing: usd(2, 12) },
  "gpt-5.6-sol": { providerId: "openai", capabilities: SEARCH_MODEL, pricing: usd(4, 20) },
};

/**
 * The profile for `modelId` on `providerId`.
 *
 * `pricingOverride` wins over the catalog, and is the only way to price a model
 * the catalog does not know. An unknown model with no override gets a profile
 * with `pricing: null`: usable against the mock, refused live.
 *
 * A catalogued model asked for on the wrong provider is treated as unknown, not
 * silently repriced — `gpt-5` on Anthropic is a configuration mistake, and
 * lending it OpenAI's price would hide it behind a plausible number.
 */
export function modelProfile(options: {
  providerId: ProviderId;
  modelId: string;
  pricingOverride?: Pricing | undefined;
}): ModelProfile {
  const entry = CATALOG[options.modelId];
  const known = entry?.providerId === options.providerId ? entry : undefined;

  return {
    providerId: options.providerId,
    modelId: options.modelId,
    // An uncatalogued model may sit behind any endpoint: search is not assumed.
    capabilities: known?.capabilities ?? TOOL_MODEL,
    pricing: options.pricingOverride ?? known?.pricing ?? null,
    defaultMaxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  };
}

/** Catalogued models for `providerId`, or all of them when it is omitted. */
export function knownModelIds(providerId?: ProviderId): string[] {
  return Object.entries(CATALOG)
    .filter(([, entry]) => providerId === undefined || entry.providerId === providerId)
    .map(([id]) => id);
}
