/**
 * Retry — backoff esponenziale con jitter
 *
 * Policy configurabile: attempts, delay, factor, jitter.
 * Usato dal job-queue e disponibile standalone.
 */

import type { RetryPolicy } from "./types.js";
import { DEFAULT_RETRY_POLICY } from "./types.js";

export type RetryOptions = Partial<RetryPolicy> & {
  label?: string;
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  onRetry?: (info: RetryInfo) => void;
};

export type RetryInfo = {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  error: unknown;
  label?: string;
};

/** Calcola il delay con backoff esponenziale e jitter */
export function computeBackoff(policy: RetryPolicy, attempt: number): number {
  const base = policy.initialDelayMs * policy.factor ** Math.max(attempt - 1, 0);
  const jitter = base * policy.jitter * Math.random();
  return Math.min(policy.maxDelayMs, Math.round(base + jitter));
}

/** Risolve una retry policy completa da opzioni parziali */
export function resolveRetryPolicy(overrides?: Partial<RetryPolicy>): RetryPolicy {
  return {
    maxAttempts: overrides?.maxAttempts ?? DEFAULT_RETRY_POLICY.maxAttempts,
    initialDelayMs: overrides?.initialDelayMs ?? DEFAULT_RETRY_POLICY.initialDelayMs,
    maxDelayMs: overrides?.maxDelayMs ?? DEFAULT_RETRY_POLICY.maxDelayMs,
    factor: overrides?.factor ?? DEFAULT_RETRY_POLICY.factor,
    jitter: overrides?.jitter ?? DEFAULT_RETRY_POLICY.jitter,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Esegue una funzione async con retry e backoff esponenziale.
 *
 * @param fn - funzione da eseguire
 * @param options - configurazione retry (opzionale, default 3 tentativi)
 * @returns risultato della funzione
 * @throws ultimo errore se tutti i tentativi falliscono
 */
export async function retryAsync<T>(
  fn: () => Promise<T>,
  options?: RetryOptions | number,
): Promise<T> {
  const opts: RetryOptions = typeof options === "number"
    ? { maxAttempts: options }
    : options ?? {};

  const policy = resolveRetryPolicy(opts);
  const shouldRetry = opts.shouldRetry ?? (() => true);
  let lastErr: unknown;

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= policy.maxAttempts || !shouldRetry(err, attempt)) break;

      const delayMs = computeBackoff(policy, attempt);
      opts.onRetry?.({
        attempt,
        maxAttempts: policy.maxAttempts,
        delayMs,
        error: err,
        label: opts.label,
      });
      await sleep(delayMs);
    }
  }
  throw lastErr ?? new Error("Retry fallito");
}
