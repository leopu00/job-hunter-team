/** Token usage and its cost in USD. */

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  /** How many of `inputTokens` were served from the provider's prefix cache, at the cached-input price. */
  cachedInputTokens?: number;
  /** How many of `inputTokens` were written to the provider's prefix cache, at the cache-write price. */
  cacheWriteTokens?: number;
  /** How many of `outputTokens` the model spent reasoning before it answered. Informational. */
  reasoningTokens?: number;
}

/**
 * A model's prices, as the provider bills ONE request. USD per million tokens.
 *
 * OpenAI reports cached input and cache writes INSIDE `input_tokens`: each
 * input token is billed once, at one of three prices (fresh, cached,
 * written to the cache). A price left out means that kind of token costs as
 * fresh input: never less than the provider could bill, which is the side a
 * cap must err on when the provider's price is not known.
 */
export interface Pricing {
  /** USD per million input tokens neither cached nor written to the cache. */
  inputPerMTokUsd: number;
  /** USD per million input tokens served from the cache. Left out: priced as input. */
  cachedInputPerMTokUsd?: number;
  /** USD per million output tokens. */
  outputPerMTokUsd: number;
  /** USD per server-side web search, charged on top of the tokens it brings in. */
  webSearchPerCallUsd?: number;
  /**
   * USD per million input tokens written to the cache, IN PLACE OF the input
   * price (OpenAI: «Cache writes are billed at 1.25x the uncached input token
   * rate»). Left out: a write costs as input, as on models whose page gives
   * no cache-write price.
   */
  cacheWritePerMTokUsd?: number;
  /**
   * Long-context rates: a request with more than `aboveInputTokens` input
   * tokens is billed at `inputMultiplier` times every input price and
   * `outputMultiplier` times the output price, for the whole request
   * (OpenAI: «Prompts with >272K input tokens are priced at 2x input and 1.5x
   * output for the full request»). It is decided per request, so a cost is
   * always computed per request and then summed, never on summed tokens.
   */
  longContext?: { aboveInputTokens: number; inputMultiplier: number; outputMultiplier: number };
}

export const ZERO_USAGE: Usage = { inputTokens: 0, outputTokens: 0 };

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cachedInputTokens: (a.cachedInputTokens ?? 0) + (b.cachedInputTokens ?? 0),
    cacheWriteTokens: (a.cacheWriteTokens ?? 0) + (b.cacheWriteTokens ?? 0),
    reasoningTokens: (a.reasoningTokens ?? 0) + (b.reasoningTokens ?? 0),
  };
}

/**
 * The tokens the token limit counts: input not served from the prefix cache
 * (cache writes included — they are part of it), plus output. A cached prefix
 * is re-read on every round, so counting it made a long session hit the
 * limit on context it had already paid for once: the first live SCOUT with
 * 87 % of its input cached stopped at round 16 (T5-bis). What a cached token
 * costs, the USD budget still counts.
 */
export function countedTokens(usage: Usage): number {
  return usage.inputTokens - (usage.cachedInputTokens ?? 0) + usage.outputTokens;
}

export function totalTokens(usage: Usage): number {
  return usage.inputTokens + usage.outputTokens;
}

/**
 * Cost in USD of ONE request whose usage is `usage`. A run's cost is the sum
 * of its requests' costs: long-context rates apply per request, so the cost
 * of summed usage is not the sum of the costs. A null `pricing` means the
 * cost is unknown, which is never treated as zero: callers must refuse a
 * live run instead.
 */
export function costUsd(usage: Usage, pricing: Pricing): number {
  return inputCostUsd(usage, pricing) + outputCostUsd(usage, pricing);
}

function isLongContext(usage: Usage, pricing: Pricing): boolean {
  return pricing.longContext !== undefined && usage.inputTokens > pricing.longContext.aboveInputTokens;
}

/**
 * The input side of `costUsd`: every input token once, at its price. Cached
 * and written tokens are part of `inputTokens`; a report claiming more of
 * them than there is input is clipped, never billed twice.
 */
export function inputCostUsd(usage: Usage, pricing: Pricing): number {
  const input = Math.max(0, usage.inputTokens);
  const cached = Math.min(input, Math.max(0, usage.cachedInputTokens ?? 0));
  const written = Math.min(input - cached, Math.max(0, usage.cacheWriteTokens ?? 0));
  const fresh = input - cached - written;
  const multiplier = isLongContext(usage, pricing) ? pricing.longContext!.inputMultiplier : 1;
  return (
    ((fresh * pricing.inputPerMTokUsd +
      cached * (pricing.cachedInputPerMTokUsd ?? pricing.inputPerMTokUsd) +
      written * (pricing.cacheWritePerMTokUsd ?? pricing.inputPerMTokUsd)) *
      multiplier) /
    1_000_000
  );
}

/** The output side of `costUsd`. */
export function outputCostUsd(usage: Usage, pricing: Pricing): number {
  const multiplier = isLongContext(usage, pricing) ? pricing.longContext!.outputMultiplier : 1;
  return (usage.outputTokens * pricing.outputPerMTokUsd * multiplier) / 1_000_000;
}

/**
 * The most `inputTokens` of input can cost before a call: none of it cached,
 * all of it written to the cache (the dearest input price), at long-context
 * rates when it is that long. Output is added by the caller, at its cap.
 */
export function worstCase(inputTokens: number): Usage {
  return { inputTokens, outputTokens: 0, cacheWriteTokens: inputTokens };
}
