/**
 * Provider Retry Runners
 *
 * Factory per retry runner specifici per provider API
 * (Claude, OpenAI, Minimax). Gestisce 429, timeout,
 * retry-after header e predicati custom.
 */

import type { RetryConfig, RetryRunner } from "./types.js";
import { resolveRetryConfig, retryAsync } from "./retry.js";

// --- Defaults per provider API ---

export const API_RETRY_DEFAULTS: Required<RetryConfig> = {
  attempts: 3,
  minDelayMs: 500,
  maxDelayMs: 60_000,
  jitter: 0.1,
};

// --- Pattern matching per errori retriable ---

const RETRIABLE_ERROR_RE =
  /429|rate.?limit|timeout|connect|reset|closed|unavailable|temporarily|overloaded/i;

function formatErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function defaultShouldRetry(err: unknown): boolean {
  return RETRIABLE_ERROR_RE.test(formatErrorMessage(err));
}

// --- Retry-after extraction da risposte API ---

function extractRetryAfterMs(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;

  let candidate: unknown;

  if ("headers" in err && err.headers && typeof err.headers === "object") {
    const headers = err.headers as Record<string, unknown>;
    candidate = headers["retry-after"] ?? headers["Retry-After"];
  }

  if (candidate === undefined && "status" in err) {
    const errObj = err as Record<string, unknown>;
    if (typeof errObj.retryAfter === "number") candidate = errObj.retryAfter;
  }

  if (typeof candidate === "number" && Number.isFinite(candidate)) {
    return candidate < 1000 ? candidate * 1000 : candidate;
  }
  if (typeof candidate === "string") {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed)) return parsed * 1000;
  }
  return undefined;
}

// --- Factory ---

export function createProviderRetryRunner(params: {
  retry?: RetryConfig;
  defaults?: Required<RetryConfig>;
  providerName?: string;
  shouldRetry?: (err: unknown) => boolean;
  retryAfterMs?: (err: unknown) => number | undefined;
  onRetry?: (label: string, attempt: number, maxRetries: number, delayMs: number) => void;
}): RetryRunner {
  const retryConfig = resolveRetryConfig(
    params.defaults ?? API_RETRY_DEFAULTS,
    params.retry,
  );
  const shouldRetry = params.shouldRetry ?? defaultShouldRetry;
  const retryAfterMs = params.retryAfterMs ?? extractRetryAfterMs;
  const providerName = params.providerName ?? "api";

  return <T>(fn: () => Promise<T>, label?: string) =>
    retryAsync(fn, {
      ...retryConfig,
      label,
      shouldRetry: (err) => shouldRetry(err),
      retryAfterMs,
      onRetry: params.onRetry
        ? (info) => {
            const maxRetries = Math.max(1, info.maxAttempts - 1);
            params.onRetry!(
              info.label ?? label ?? "request",
              info.attempt,
              maxRetries,
              info.delayMs,
            );
          }
        : (info) => {
            const maxRetries = Math.max(1, info.maxAttempts - 1);
            console.warn(
              `[rate-limiter:${providerName}] ${info.label ?? label ?? "request"} retry ${info.attempt}/${maxRetries} in ${info.delayMs}ms`,
            );
          },
    });
}
