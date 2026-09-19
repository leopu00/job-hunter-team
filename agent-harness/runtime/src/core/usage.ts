/** Token usage and its cost in USD. */

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  /**
   * How many of `inputTokens` were served from the provider's prefix cache.
   * Informational: cost below charges every input token at full price, which
   * overstates spend on cached prefixes — the safe direction for a cap.
   */
  cachedInputTokens?: number;
  /** How many of `inputTokens` were written to the provider's prefix cache. Informational. */
  cacheWriteTokens?: number;
  /** How many of `outputTokens` the model spent reasoning before it answered. Informational. */
  reasoningTokens?: number;
}

export interface Pricing {
  /** USD per million input tokens. */
  inputPerMTokUsd: number;
  /** USD per million output tokens. */
  outputPerMTokUsd: number;
  /** USD per server-side web search, charged on top of the tokens it brings in. */
  webSearchPerCallUsd?: number;
  /**
   * USD per million tokens written to the provider's prefix cache, charged ON
   * TOP of their input price. OpenAI reports them inside `inputTokens`; adding
   * the full write price again overstates spend, which is the side a cap
   * should err on.
   */
  cacheWritePerMTokUsd?: number;
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
 * Cost of `usage` in USD. A null `pricing` means the cost is unknown, which is
 * never treated as zero: callers must refuse a live run instead.
 */
export function costUsd(usage: Usage, pricing: Pricing): number {
  return inputCostUsd(usage, pricing) + (usage.outputTokens / 1_000_000) * pricing.outputPerMTokUsd;
}

/** The input side of `costUsd`: input tokens, plus the cache writes among them. */
export function inputCostUsd(usage: Usage, pricing: Pricing): number {
  return (
    (usage.inputTokens / 1_000_000) * pricing.inputPerMTokUsd +
    ((usage.cacheWriteTokens ?? 0) / 1_000_000) * (pricing.cacheWritePerMTokUsd ?? 0)
  );
}
