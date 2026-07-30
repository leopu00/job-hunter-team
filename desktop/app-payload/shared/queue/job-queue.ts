/**
 * Job Queue — coda asincrona con priorita', retry e dead-letter
 *
 * Concorrenza configurabile, handler per nome job,
 * dead-letter queue per job falliti permanentemente.
 */

import { randomUUID } from "node:crypto";
import type {
  JobRecord,
  JobPriority,
  JobStatus,
  JobHandler,
  QueueEvent,
  QueueEventListener,
  QueueStats,
  QueueOptions,
} from "./types.js";
import { PRIORITY_VALUES } from "./types.js";
import { computeBackoff, resolveRetryPolicy } from "./retry.js";
import type { RetryPolicy } from "./types.js";

export class JobQueue {
  private pending: JobRecord[] = [];
  private running = new Map<string, JobRecord>();
  private completed: JobRecord[] = [];
  private deadLetter: JobRecord[] = [];
  private handlers = new Map<string, JobHandler<any, any>>();
  private listeners: QueueEventListener[] = [];
  private concurrency: number;
  private retryPolicy: RetryPolicy;
  private maxDlqSize: number;
  private processing = false;

  constructor(options?: QueueOptions) {
    this.concurrency = options?.concurrency ?? 1;
    this.retryPolicy = resolveRetryPolicy(options?.retryPolicy);
    this.maxDlqSize = options?.maxDeadLetterSize ?? 100;
  }

  registerHandler<T, R>(name: string, handler: JobHandler<T, R>): void {
    this.handlers.set(name, handler);
  }

  on(listener: QueueEventListener): () => void {
    this.listeners.push(listener);
    return () => { this.listeners = this.listeners.filter((l) => l !== listener); };
  }

  private emit(event: QueueEvent): void {
    for (const l of this.listeners) { try { l(event); } catch {} }
  }

  enqueue<T>(name: string, payload: T, priority: JobPriority = "normal"): JobRecord<T> {
    const job: JobRecord<T> = {
      id: randomUUID(), name, payload, priority,
      status: "queued", attempts: 0,
      maxAttempts: this.retryPolicy.maxAttempts,
      createdAt: Date.now(),
    };
    this.pending.push(job);
    this.pending.sort((a, b) => PRIORITY_VALUES[a.priority] - PRIORITY_VALUES[b.priority]);
    this.emit({ kind: "enqueued", job });
    this.process();
    return job;
  }

  private async process(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.pending.length > 0 && this.running.size < this.concurrency) {
        const job = this.pending.shift()!;
        this.running.set(job.id, job);
        this.executeJob(job);
      }
    } finally {
      this.processing = false;
    }
  }

  private async executeJob(job: JobRecord): Promise<void> {
    const handler = this.handlers.get(job.name);
    if (!handler) {
      job.status = "dead";
      job.lastError = `Nessun handler registrato per "${job.name}"`;
      this.moveToDead(job);
      return;
    }
    job.status = "running";
    job.startedAt = Date.now();
    job.attempts++;
    this.emit({ kind: "started", job });
    try {
      job.result = await handler(job.payload, job);
      job.status = "succeeded";
      job.endedAt = Date.now();
      this.running.delete(job.id);
      this.completed.push(job);
      this.emit({ kind: "succeeded", job });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      job.lastError = errorMsg;
      this.running.delete(job.id);
      if (job.attempts >= job.maxAttempts) {
        job.status = "dead";
        job.endedAt = Date.now();
        this.moveToDead(job);
        this.emit({ kind: "dead", job, error: errorMsg });
      } else {
        job.status = "failed";
        const delayMs = computeBackoff(this.retryPolicy, job.attempts);
        job.nextRetryAt = Date.now() + delayMs;
        this.emit({ kind: "retry", job, delayMs });
        this.emit({ kind: "failed", job, error: errorMsg });
        setTimeout(() => {
          job.status = "queued";
          job.nextRetryAt = undefined;
          this.pending.push(job);
          this.pending.sort((a, b) => PRIORITY_VALUES[a.priority] - PRIORITY_VALUES[b.priority]);
          this.process();
        }, delayMs);
      }
    }
    this.process();
  }

  private moveToDead(job: JobRecord): void {
    this.deadLetter.push(job);
    if (this.deadLetter.length > this.maxDlqSize) {
      this.deadLetter.shift();
    }
  }

  getStats(): QueueStats {
    return {
      queued: this.pending.length,
      running: this.running.size,
      succeeded: this.completed.filter((j) => j.status === "succeeded").length,
      failed: this.completed.filter((j) => j.status === "failed").length,
      dead: this.deadLetter.length,
      totalProcessed: this.completed.length + this.deadLetter.length,
    };
  }

  getDeadLetterJobs(): JobRecord[] { return [...this.deadLetter]; }
  getPendingJobs(): JobRecord[] { return [...this.pending]; }
  getRunningJobs(): JobRecord[] { return [...this.running.values()]; }

  retryDeadJob(jobId: string): boolean {
    const idx = this.deadLetter.findIndex((j) => j.id === jobId);
    if (idx === -1) return false;
    const [job] = this.deadLetter.splice(idx, 1);
    job.status = "queued";
    job.attempts = 0;
    job.lastError = undefined;
    job.endedAt = undefined;
    this.pending.push(job);
    this.pending.sort((a, b) => PRIORITY_VALUES[a.priority] - PRIORITY_VALUES[b.priority]);
    this.process();
    return true;
  }

  clearDeadLetter(): number {
    const count = this.deadLetter.length;
    this.deadLetter = [];
    return count;
  }

  clear(): void {
    this.pending = [];
    this.running.clear();
    this.completed = [];
    this.deadLetter = [];
  }
}
