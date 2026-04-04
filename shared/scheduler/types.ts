/**
 * Scheduler — Tipi per scheduler avanzato con priorita' e dipendenze
 */

export type TaskPriority = 'critical' | 'high' | 'normal' | 'low';
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout';

export const PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  critical: 0, high: 1, normal: 2, low: 3,
};

/** Task schedulato */
export interface ScheduledTask {
  id: string;
  name: string;
  priority: TaskPriority;
  status: TaskStatus;
  fn: () => Promise<unknown> | unknown;
  dependsOn: string[];
  timeoutMs?: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  result?: unknown;
}

/** Opzioni per enqueue */
export interface EnqueueOptions {
  priority?: TaskPriority;
  dependsOn?: string[];
  timeoutMs?: number;
}

/** Configurazione scheduler */
export interface SchedulerConfig {
  concurrency?: number;
  defaultTimeoutMs?: number;
  onTaskComplete?: (task: ScheduledTask) => void;
  onTaskError?: (task: ScheduledTask) => void;
}

export const DEFAULT_SCHEDULER_CONFIG: Required<Omit<SchedulerConfig, 'onTaskComplete' | 'onTaskError'>> = {
  concurrency: 3,
  defaultTimeoutMs: 60_000,
};

/** Statistiche scheduler */
export interface SchedulerStats {
  pending: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
}
