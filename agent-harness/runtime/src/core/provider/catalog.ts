/**
 * Model profiles.
 *
 * Capabilities and prices are declared, never inferred from a model name.
 * A model absent from this table is not refused — it
 * must supply its pricing through configuration, because a run whose cost
 * cannot be computed cannot be capped, and an uncappable live run is refused.
 *
 * Prices are USD per million tokens at standard (non-batch) rates, first-party
 * API. Sources and dates are per block below. They go stale, and the cap is
 * only as right as they are: a run stopped at a fifth of its budget is as
 * wrong as one let past it (JHT-API-TEST A2, A5). `npm run spend -- reconcile`
 * checks them against what OpenAI billed.
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

/**
 * Long-context rates of the gpt-5.6 models (luna, terra, sol): «Prompts with
 * >272K input tokens are priced at 2x input and 1.5x output for the full
 * request», on each model's page (developers.openai.com/api/docs/models/
 * <model>, read 2026-09-27). Per request: a run's rounds stay far below it,
 * so short rates are what they pay. gpt-5 and gpt-5-mini have no
 * long-context price.
 */
const GPT_5_6_LONG_CONTEXT = { aboveInputTokens: 272_000, inputMultiplier: 2, outputMultiplier: 1.5 } as const;

/** Cache writes on the gpt-5.6 models: «billed at 1.25x the uncached input token rate», in place of it. */
const CACHE_WRITE_MULTIPLIER = 1.25;

function usd(prices: {
  input: number;
  cachedInput: number;
  output: number;
  cacheWrites?: boolean;
  longContext?: Pricing["longContext"];
}): Pricing {
  return {
    inputPerMTokUsd: prices.input,
    cachedInputPerMTokUsd: prices.cachedInput,
    outputPerMTokUsd: prices.output,
    webSearchPerCallUsd: WEB_SEARCH_PER_CALL_USD,
    ...(prices.cacheWrites ? { cacheWritePerMTokUsd: prices.input * CACHE_WRITE_MULTIPLIER } : {}),
    ...(prices.longContext ? { longContext: prices.longContext } : {}),
  };
}

const CATALOG: Record<string, CatalogEntry> = {
  // OpenAI, standard tier, first-party API: each model's own page
  // (developers.openai.com/api/docs/models/<model>), read 2026-09-27, and
  // /api/docs/pricing for the columns. The API budget is OpenAI's, so only
  // OpenAI is catalogued: any other model runs live only with an explicit
  // JHT_API_PRICE_* override. Cheapest first; pick the cheapest one that
  // holds the role.
  //
  // Until 2026-09-27 luna was priced at its long-context rates on every
  // request, cached input at the full input price and cache writes on top of
  // it: several times what OpenAI billed for the same runs. The key proxy
  // made the same count, so the two agreed to the cent and were wrong
  // together; only the invoice could tell.
  "gpt-5.6-luna": {
    providerId: "openai",
    capabilities: SEARCH_MODEL,
    pricing: usd({ input: 0.2, cachedInput: 0.02, output: 1.2, cacheWrites: true, longContext: GPT_5_6_LONG_CONTEXT }),
  },
  // No cache-write or long-context price on mini's or gpt-5's page.
  "gpt-5-mini": { providerId: "openai", capabilities: SEARCH_MODEL, pricing: usd({ input: 0.25, cachedInput: 0.025, output: 2 }) },
  "gpt-5": { providerId: "openai", capabilities: SEARCH_MODEL, pricing: usd({ input: 1.25, cachedInput: 0.125, output: 10 }) },
  "gpt-5.6-terra": {
    providerId: "openai",
    capabilities: SEARCH_MODEL,
    pricing: usd({ input: 2, cachedInput: 0.2, output: 12, cacheWrites: true, longContext: GPT_5_6_LONG_CONTEXT }),
  },
  "gpt-5.6-sol": {
    providerId: "openai",
    capabilities: SEARCH_MODEL,
    pricing: usd({ input: 4, cachedInput: 0.4, output: 20, cacheWrites: true, longContext: GPT_5_6_LONG_CONTEXT }),
  },
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
