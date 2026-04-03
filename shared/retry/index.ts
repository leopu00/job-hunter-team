/**
 * Modulo retry e circuit breaker per JHT.
 *
 * Uso:
 *   import { retryAsync, CircuitBreaker } from "./shared/retry/index.js";
 *
 *   // Retry semplice con backoff
 *   const data = await retryAsync(() => fetchData(), { attempts: 3, jitter: 0.1 });
 *
 *   // Circuit breaker per servizio esterno
 *   const breaker = new CircuitBreaker({ failureThreshold: 5 });
 *   const result = await breaker.execute(() => callExternalApi());
 */

export {
  retryAsync,
  resolveRetryConfig,
  computeBackoff,
  sleepWithAbort,
  isTransientError,
  createRetryRunner,
} from "./retry.js";

export {
  CircuitBreaker,
  CircuitBreakerOpenError,
} from "./circuit-breaker.js";

export type {
  RetryConfig,
  RetryOptions,
  RetryInfo,
  RetryRunner,
  CircuitState,
  CircuitBreakerConfig,
  CircuitBreakerStatus,
} from "./types.js";

export { DEFAULT_RETRY_CONFIG, DEFAULT_CIRCUIT_CONFIG } from "./types.js";
