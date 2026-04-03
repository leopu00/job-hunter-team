/**
 * Modulo queue — job queue asincrona per agenti
 *
 * Priorita', retry con backoff, dead-letter queue.
 */

// Tipi
export type {
  JobStatus,
  JobPriority,
  RetryPolicy,
  JobRecord,
  JobHandler,
  QueueEvent,
  QueueEventListener,
  QueueStats,
  QueueOptions,
} from "./types.js";

export { PRIORITY_VALUES, DEFAULT_RETRY_POLICY } from "./types.js";

// Retry
export type { RetryOptions, RetryInfo } from "./retry.js";

export {
  computeBackoff,
  resolveRetryPolicy,
  retryAsync,
} from "./retry.js";

// Job Queue
export { JobQueue } from "./job-queue.js";
