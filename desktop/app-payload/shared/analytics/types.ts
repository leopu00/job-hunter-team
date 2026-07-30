/**
 * Analytics — Tipi core
 *
 * Metriche: chiamate API per provider, token usati,
 * latenza media, costo stimato per modello.
 */

// ── Provider e modello ─────────────────────────────────────────────────────

export type ProviderName = "claude" | "openai" | "minimax";

/** Costo per milione di token per un modello */
export type ModelCost = {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
};

// ── Token usage ────────────────────────────────────────────────────────────

/** Token usati in una singola chiamata */
export type TokenUsage = {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  total: number;
};

// ── Singola entry ──────────────────────────────────────────────────────────

/** Registrazione di una singola chiamata API */
export type UsageEntry = {
  id: string;
  provider: ProviderName;
  model: string;
  tokens: TokenUsage;
  latencyMs: number;
  costUsd: number;
  timestamp: number;
  agentId?: string;
  success: boolean;
  error?: string;
};

// ── Latenza ────────────────────────────────────────────────────────────────

/** Statistiche latenza aggregate */
export type LatencyStats = {
  count: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  p95Ms: number;
};

// ── Aggregazioni ───────────────────────────────────────────────────────────

/** Aggregazione per provider */
export type ProviderStats = {
  provider: ProviderName;
  calls: number;
  tokens: TokenUsage;
  costUsd: number;
  latency: LatencyStats;
  errors: number;
};

/** Aggregazione per modello */
export type ModelStats = {
  provider: ProviderName;
  model: string;
  calls: number;
  tokens: TokenUsage;
  costUsd: number;
  latency: LatencyStats;
};

/** Aggregazione giornaliera */
export type DailyStats = {
  date: string;
  calls: number;
  tokens: number;
  costUsd: number;
  errors: number;
};

/** Riepilogo globale */
export type UsageSummary = {
  totalCalls: number;
  totalTokens: number;
  totalCostUsd: number;
  totalErrors: number;
  byProvider: ProviderStats[];
  byModel: ModelStats[];
  daily: DailyStats[];
  latency: LatencyStats;
  periodStart: number;
  periodEnd: number;
};

// ── Snapshot per persistenza ───────────────────────────────────────────────

export type AnalyticsSnapshot = {
  version: 1;
  updatedAt: number;
  entries: UsageEntry[];
};
