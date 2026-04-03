/**
 * Usage Tracker — registrazione e aggregazione metriche API
 *
 * Registry in-memory: registra chiamate, calcola costo,
 * aggrega per provider/modello/giorno con latenza p95.
 */

import { randomUUID } from "node:crypto";
import type {
  ProviderName,
  ModelCost,
  TokenUsage,
  UsageEntry,
  LatencyStats,
  ProviderStats,
  ModelStats,
  DailyStats,
  UsageSummary,
} from "./types.js";

const entries: UsageEntry[] = [];

const MODEL_COSTS: Record<string, ModelCost> = {
  "claude:claude-opus-4-6":    { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  "claude:claude-sonnet-4-6":  { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude:claude-haiku-4-5":   { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
  "openai:gpt-4o":             { input: 2.5, output: 10, cacheRead: 1.25 },
  "openai:gpt-4o-mini":        { input: 0.15, output: 0.6, cacheRead: 0.075 },
  "openai:o3":                 { input: 10, output: 40, cacheRead: 2.5 },
  "minimax:minimax-01":        { input: 1, output: 5 },
};

export function getModelCost(provider: ProviderName, model: string): ModelCost | undefined {
  return MODEL_COSTS[`${provider}:${model}`];
}

export function setModelCost(provider: ProviderName, model: string, cost: ModelCost): void {
  MODEL_COSTS[`${provider}:${model}`] = cost;
}

export function estimateCost(tokens: TokenUsage, cost: ModelCost): number {
  let total = (tokens.input * cost.input + tokens.output * cost.output) / 1_000_000;
  if (tokens.cacheRead && cost.cacheRead) total += (tokens.cacheRead * cost.cacheRead) / 1_000_000;
  if (tokens.cacheWrite && cost.cacheWrite) total += (tokens.cacheWrite * cost.cacheWrite) / 1_000_000;
  return Math.round(total * 1_000_000) / 1_000_000;
}

export type RecordCallParams = {
  provider: ProviderName;
  model: string;
  tokens: Omit<TokenUsage, "total">;
  latencyMs: number;
  agentId?: string;
  success?: boolean;
  error?: string;
};

export function recordCall(params: RecordCallParams): UsageEntry {
  const total = params.tokens.input + params.tokens.output
    + (params.tokens.cacheRead ?? 0) + (params.tokens.cacheWrite ?? 0);
  const tokens: TokenUsage = { ...params.tokens, total };
  const modelCost = getModelCost(params.provider, params.model);
  const costUsd = modelCost ? estimateCost(tokens, modelCost) : 0;
  const entry: UsageEntry = {
    id: randomUUID(),
    provider: params.provider,
    model: params.model,
    tokens,
    latencyMs: params.latencyMs,
    costUsd,
    timestamp: Date.now(),
    agentId: params.agentId,
    success: params.success ?? true,
    error: params.error,
  };
  entries.push(entry);
  return entry;
}

function computeLatency(values: number[]): LatencyStats {
  if (values.length === 0) return { count: 0, avgMs: 0, minMs: 0, maxMs: 0, p95Ms: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    count: sorted.length,
    avgMs: Math.round(sum / sorted.length),
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
  };
}

function emptyTokens(): TokenUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
}

function addTokens(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: (a.cacheRead ?? 0) + (b.cacheRead ?? 0),
    cacheWrite: (a.cacheWrite ?? 0) + (b.cacheWrite ?? 0),
    total: a.total + b.total,
  };
}

function toDateStr(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export function getSummary(since?: number): UsageSummary {
  const filtered = since ? entries.filter((e) => e.timestamp >= since) : entries;
  const providerMap = new Map<string, { entries: UsageEntry[] }>();
  const modelMap = new Map<string, { entries: UsageEntry[] }>();
  const dailyMap = new Map<string, DailyStats>();

  for (const e of filtered) {
    const pk = e.provider;
    if (!providerMap.has(pk)) providerMap.set(pk, { entries: [] });
    providerMap.get(pk)!.entries.push(e);

    const mk = `${e.provider}:${e.model}`;
    if (!modelMap.has(mk)) modelMap.set(mk, { entries: [] });
    modelMap.get(mk)!.entries.push(e);

    const dk = toDateStr(e.timestamp);
    const day = dailyMap.get(dk) ?? { date: dk, calls: 0, tokens: 0, costUsd: 0, errors: 0 };
    day.calls++;
    day.tokens += e.tokens.total;
    day.costUsd += e.costUsd;
    if (!e.success) day.errors++;
    dailyMap.set(dk, day);
  }

  const byProvider: ProviderStats[] = [...providerMap.entries()].map(([provider, { entries: es }]) => {
    let tokens = emptyTokens();
    let cost = 0;
    let errors = 0;
    for (const e of es) { tokens = addTokens(tokens, e.tokens); cost += e.costUsd; if (!e.success) errors++; }
    return { provider: provider as ProviderName, calls: es.length, tokens, costUsd: cost, latency: computeLatency(es.map((e) => e.latencyMs)), errors };
  });

  const byModel: ModelStats[] = [...modelMap.entries()].map(([key, { entries: es }]) => {
    const [provider, model] = key.split(":");
    let tokens = emptyTokens();
    let cost = 0;
    for (const e of es) { tokens = addTokens(tokens, e.tokens); cost += e.costUsd; }
    return { provider: provider as ProviderName, model, calls: es.length, tokens, costUsd: cost, latency: computeLatency(es.map((e) => e.latencyMs)) };
  });

  const daily = [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date));
  let totalTokens = 0; let totalCost = 0; let totalErrors = 0;
  for (const e of filtered) { totalTokens += e.tokens.total; totalCost += e.costUsd; if (!e.success) totalErrors++; }
  const timestamps = filtered.map((e) => e.timestamp);

  return {
    totalCalls: filtered.length,
    totalTokens, totalCostUsd: totalCost, totalErrors,
    byProvider, byModel, daily,
    latency: computeLatency(filtered.map((e) => e.latencyMs)),
    periodStart: timestamps.length ? Math.min(...timestamps) : 0,
    periodEnd: timestamps.length ? Math.max(...timestamps) : 0,
  };
}

export function getEntries(): UsageEntry[] { return [...entries]; }
export function getEntryCount(): number { return entries.length; }

export function restoreEntries(restored: UsageEntry[]): void {
  entries.length = 0;
  entries.push(...restored);
}

export function clearEntries(): void { entries.length = 0; }

export function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(value));
}

export function formatUsd(value: number): string {
  if (value >= 0.01) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(4)}`;
}
