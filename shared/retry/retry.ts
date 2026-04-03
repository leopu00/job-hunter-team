/**
 * Retry con exponential backoff per JHT.
 *
 * Supporta jitter, Retry-After, shouldRetry predicato,
 * e callback onRetry per logging/monitoring.
 */

import { setTimeout as delay } from "node:timers/promises";
import type { RetryConfig, RetryOptions, RetryInfo, RetryRunner } from "./types.js";
import { DEFAULT_RETRY_CONFIG } from "./types.js";

// ── CONFIG RESOLUTION ──────────────────────────────────────

/** Risolvi e valida una config retry, con fallback ai default */
export function resolveRetryConfig(
  defaults: RetryConfig = DEFAULT_RETRY_CONFIG,
  overrides?: Partial<RetryConfig>,
): RetryConfig {
  const attempts = Math.max(1, Math.round(overrides?.attempts ?? defaults.attempts));
  const minDelayMs = Math.max(0, Math.round(overrides?.minDelayMs ?? defaults.minDelayMs));
  const maxDelayMs = Math.max(minDelayMs, Math.round(overrides?.maxDelayMs ?? defaults.maxDelayMs));
  const jitter = Math.min(1, Math.max(0, overrides?.jitter ?? defaults.jitter));
  return { attempts, minDelayMs, maxDelayMs, jitter };
}

// ── BACKOFF COMPUTATION ────────────────────────────────────

/** Calcola delay con exponential backoff: minDelay * 2^(attempt-1) */
export function computeBackoff(minDelayMs: number, maxDelayMs: number, attempt: number): number {
  const base = minDelayMs * 2 ** Math.max(attempt - 1, 0);
  return Math.min(base, maxDelayMs);
}

/** Applica jitter simmetrico al delay */
function applyJitter(delayMs: number, jitter: number): number {
  if (jitter <= 0) return delayMs;
  const offset = (Math.random() * 2 - 1) * jitter;
  return Math.max(0, Math.round(delayMs * (1 + offset)));
}

// ── RETRY ASYNC ────────────────────────────────────────────

/** Esegui una funzione async con retry ed exponential backoff */
export async function retryAsync<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const config = resolveRetryConfig(DEFAULT_RETRY_CONFIG, options);
  const { attempts, minDelayMs, maxDelayMs, jitter } = config;
  const shouldRetry = options.shouldRetry ?? (() => true);
  let lastErr: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= attempts || !shouldRetry(err, attempt)) break;

      const retryAfter = options.retryAfterMs?.(err);
      const hasRetryAfter = typeof retryAfter === "number" && Number.isFinite(retryAfter);
      const baseDelay = hasRetryAfter
        ? Math.max(retryAfter, minDelayMs)
        : computeBackoff(minDelayMs, maxDelayMs, attempt);
      let waitMs = applyJitter(baseDelay, jitter);
      waitMs = Math.min(Math.max(waitMs, minDelayMs), maxDelayMs);

      options.onRetry?.({ attempt, maxAttempts: attempts, delayMs: waitMs, err, label: options.label });
      await delay(waitMs);
    }
  }

  throw lastErr ?? new Error("Retry esaurito");
}

// ── SLEEP WITH ABORT ───────────────────────────────────────

/** Sleep interrompibile via AbortSignal */
export async function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  try {
    await delay(ms, undefined, { signal });
  } catch (err) {
    if (signal?.aborted) throw new Error("Operazione annullata", { cause: err });
    throw err;
  }
}

// ── RETRY RUNNER FACTORY ───────────────────────────────────

/** Errori HTTP/rete comuni da ritentare */
const TRANSIENT_ERROR_RE = /429|timeout|connect|reset|closed|unavailable|temporarily|ECONNREFUSED|ETIMEDOUT/i;

export function isTransientError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return TRANSIENT_ERROR_RE.test(msg);
}

/** Crea un RetryRunner riutilizzabile con config fissa */
export function createRetryRunner(params: {
  config?: Partial<RetryConfig>;
  shouldRetry?: (err: unknown) => boolean;
  retryAfterMs?: (err: unknown) => number | undefined;
  onRetry?: (info: RetryInfo) => void;
}): RetryRunner {
  const config = resolveRetryConfig(DEFAULT_RETRY_CONFIG, params.config);
  return <T>(fn: () => Promise<T>, label?: string) =>
    retryAsync(fn, {
      ...config,
      label,
      shouldRetry: params.shouldRetry ? (err) => params.shouldRetry!(err) : undefined,
      retryAfterMs: params.retryAfterMs,
      onRetry: params.onRetry,
    });
}
