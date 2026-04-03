/**
 * Job Queue — Tipi core
 *
 * Coda asincrona con priorita', retry con backoff,
 * dead-letter queue per job falliti permanentemente.
 */

// ── Stato e priorita' ─────────────────────────────────────────────────────

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "dead";

export type JobPriority = "low" | "normal" | "high" | "critical";

export const PRIORITY_VALUES: Record<JobPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

// ── Retry ──────────────────────────────────────────────────────────────────

export type RetryPolicy = {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  factor: number;
  jitter: number;
};

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  initialDelayMs: 300,
  maxDelayMs: 30_000,
  factor: 2,
  jitter: 0.1,
};

// ── Job record ─────────────────────────────────────────────────────────────

export type JobRecord<T = unknown> = {
  id: string;
  name: string;
  payload: T;
  priority: JobPriority;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  nextRetryAt?: number;
  lastError?: string;
  result?: unknown;
};

// ── Handler ────────────────────────────────────────────────────────────────

/** Funzione che esegue un job */
export type JobHandler<T = unknown, R = unknown> = (
  payload: T,
  job: JobRecord<T>,
) => Promise<R>;

// ── Eventi ─────────────────────────────────────────────────────────────────

export type QueueEvent =
  | { kind: "enqueued"; job: JobRecord }
  | { kind: "started"; job: JobRecord }
  | { kind: "succeeded"; job: JobRecord }
  | { kind: "failed"; job: JobRecord; error: string }
  | { kind: "retry"; job: JobRecord; delayMs: number }
  | { kind: "dead"; job: JobRecord; error: string };

export type QueueEventListener = (event: QueueEvent) => void;

// ── Stats ──────────────────────────────────────────────────────────────────

export type QueueStats = {
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  dead: number;
  totalProcessed: number;
};

// ── Opzioni coda ───────────────────────────────────────────────────────────

export type QueueOptions = {
  concurrency?: number;
  retryPolicy?: Partial<RetryPolicy>;
  maxDeadLetterSize?: number;
};
