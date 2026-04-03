/**
 * Tipi per il sistema retry e circuit breaker JHT.
 */

// ── RETRY CONFIG ───────────────────────────────────────────

export interface RetryConfig {
  /** Numero massimo di tentativi (default: 3) */
  attempts: number;
  /** Delay minimo tra tentativi in ms (default: 300) */
  minDelayMs: number;
  /** Delay massimo tra tentativi in ms (default: 30000) */
  maxDelayMs: number;
  /** Fattore jitter 0–1 per randomizzare il delay (default: 0) */
  jitter: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  attempts: 3,
  minDelayMs: 300,
  maxDelayMs: 30_000,
  jitter: 0,
};

export interface RetryOptions extends Partial<RetryConfig> {
  /** Etichetta per logging/diagnostica */
  label?: string;
  /** Predicato: ritorna true se l'errore è ritentabile */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  /** Estrae delay Retry-After dall'errore (in ms) */
  retryAfterMs?: (err: unknown) => number | undefined;
  /** Callback invocata prima di ogni retry */
  onRetry?: (info: RetryInfo) => void;
}

export interface RetryInfo {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  err: unknown;
  label?: string;
}

// ── CIRCUIT BREAKER CONFIG ─────────────────────────────────

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerConfig {
  /** Soglia errori consecutivi per aprire il circuito (default: 5) */
  failureThreshold: number;
  /** Tempo in ms prima di passare a half-open (default: 30000) */
  resetTimeoutMs: number;
  /** Numero di successi in half-open per chiudere il circuito (default: 1) */
  halfOpenSuccesses: number;
}

export const DEFAULT_CIRCUIT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  halfOpenSuccesses: 1,
};

export interface CircuitBreakerStatus {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureAt?: number;
  lastSuccessAt?: number;
  openedAt?: number;
}

// ── RETRY RUNNER ───────────────────────────────────────────

/** Funzione riutilizzabile per eseguire retry con config fissa */
export type RetryRunner = <T>(fn: () => Promise<T>, label?: string) => Promise<T>;
