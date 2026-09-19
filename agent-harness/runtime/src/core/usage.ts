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

export function totalTokens(usage: Usage): number {
  return usage.inputTokens + usage.outputTokens;
}

/**
 * Cost of `usage` in USD. A null `pricing` means the cost is unknown, which is
 * never treated as zero: callers must refuse a live run instead.
 */
export function costUsd(usage: Usage, pricing: Pricing): number {
  return (
    (usage.inputTokens / 1_000_000) * pricing.inputPerMTokUsd +
    (usage.outputTokens / 1_000_000) * pricing.outputPerMTokUsd
  );
}
