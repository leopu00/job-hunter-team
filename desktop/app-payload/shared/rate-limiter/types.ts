/**
 * Rate Limiter — Tipi e interfacce
 *
 * Tipi per rate limiting (fixed window), retry con backoff
 * esponenziale e runner per provider API.
 */

// --- Rate Limiter ---

export type ConsumeResult = {
  allowed: boolean;
  retryAfterMs: number;
  remaining: number;
};

export type FixedWindowRateLimiter = {
  consume: () => ConsumeResult;
  reset: () => void;
};

// --- Retry ---

export type RetryConfig = {
  attempts?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  jitter?: number;
};

export type RetryInfo = {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  err: unknown;
  label?: string;
};

export type RetryOptions = RetryConfig & {
  label?: string;
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  retryAfterMs?: (err: unknown) => number | undefined;
  onRetry?: (info: RetryInfo) => void;
};

export type RetryRunner = <T>(fn: () => Promise<T>, label?: string) => Promise<T>;
