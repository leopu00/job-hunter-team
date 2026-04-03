/**
 * Circuit breaker per JHT.
 *
 * Protegge da cascading failures con tre stati:
 * - closed: funzionamento normale, conta errori consecutivi
 * - open: blocca chiamate, attende reset timeout
 * - half-open: lascia passare tentativi limitati per verificare ripristino
 */

import type { CircuitBreakerConfig, CircuitBreakerStatus, CircuitState } from "./types.js";
import { DEFAULT_CIRCUIT_CONFIG } from "./types.js";

export class CircuitBreakerOpenError extends Error {
  constructor(public readonly remainingMs: number) {
    super(`Circuito aperto — riprova tra ${Math.ceil(remainingMs / 1000)}s`);
    this.name = "CircuitBreakerOpenError";
  }
}

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failures = 0;
  private halfOpenSuccesses = 0;
  private lastFailureAt?: number;
  private lastSuccessAt?: number;
  private openedAt?: number;
  private config: CircuitBreakerConfig;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CIRCUIT_CONFIG, ...config };
  }

  /** Esegui una funzione protetta dal circuit breaker */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.checkState();

    if (this.state === "open") {
      throw new CircuitBreakerOpenError(this.remainingResetMs());
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  /** Registra un successo manualmente */
  onSuccess(): void {
    this.lastSuccessAt = Date.now();

    if (this.state === "half-open") {
      this.halfOpenSuccesses++;
      if (this.halfOpenSuccesses >= this.config.halfOpenSuccesses) {
        this.close();
      }
    } else if (this.state === "closed") {
      this.failures = 0;
    }
  }

  /** Registra un fallimento manualmente */
  onFailure(): void {
    this.lastFailureAt = Date.now();
    this.failures++;

    if (this.state === "half-open") {
      this.open();
    } else if (this.state === "closed" && this.failures >= this.config.failureThreshold) {
      this.open();
    }
  }

  /** Stato corrente del circuit breaker */
  getStatus(): CircuitBreakerStatus {
    this.checkState();
    return {
      state: this.state,
      failures: this.failures,
      successes: this.halfOpenSuccesses,
      lastFailureAt: this.lastFailureAt,
      lastSuccessAt: this.lastSuccessAt,
      openedAt: this.openedAt,
    };
  }

  /** Reset forzato a closed */
  reset(): void {
    this.close();
  }

  /** Verifica se il circuito permette chiamate */
  isCallPermitted(): boolean {
    this.checkState();
    return this.state !== "open";
  }

  // ── STATE TRANSITIONS ──────────────────────────────────────

  private open(): void {
    this.state = "open";
    this.openedAt = Date.now();
    this.halfOpenSuccesses = 0;
  }

  private close(): void {
    this.state = "closed";
    this.failures = 0;
    this.halfOpenSuccesses = 0;
    this.openedAt = undefined;
  }

  private checkState(): void {
    if (this.state === "open" && this.remainingResetMs() <= 0) {
      this.state = "half-open";
      this.halfOpenSuccesses = 0;
    }
  }

  private remainingResetMs(): number {
    if (!this.openedAt) return 0;
    const elapsed = Date.now() - this.openedAt;
    return Math.max(0, this.config.resetTimeoutMs - elapsed);
  }
}
