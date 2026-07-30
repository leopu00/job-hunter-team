/**
 * Scheduler — Scheduler avanzato con priorita', dipendenze, timeout
 */

export type {
  ScheduledTask, TaskPriority, TaskStatus,
  EnqueueOptions, SchedulerConfig, SchedulerStats,
} from './types.js';
export { PRIORITY_WEIGHT, DEFAULT_SCHEDULER_CONFIG } from './types.js';

export {
  configureScheduler, enqueue, cancel, getTask,
  listTasks, getStats, hasCyclicDeps, resetScheduler,
} from './scheduler.js';
