/**
 * Scheduler — Coda prioritaria con dipendenze, timeout, cancellazione
 */
import type { ScheduledTask, TaskStatus, EnqueueOptions, SchedulerConfig, SchedulerStats } from './types.js';
import { PRIORITY_WEIGHT, DEFAULT_SCHEDULER_CONFIG } from './types.js';

const tasks = new Map<string, ScheduledTask>();
let running = 0;
let concurrency = DEFAULT_SCHEDULER_CONFIG.concurrency;
let defaultTimeout = DEFAULT_SCHEDULER_CONFIG.defaultTimeoutMs;
let onComplete: SchedulerConfig['onTaskComplete'];
let onError: SchedulerConfig['onTaskError'];

/** Configura lo scheduler */
export function configureScheduler(config: SchedulerConfig): void {
  concurrency = config.concurrency ?? DEFAULT_SCHEDULER_CONFIG.concurrency;
  defaultTimeout = config.defaultTimeoutMs ?? DEFAULT_SCHEDULER_CONFIG.defaultTimeoutMs;
  onComplete = config.onTaskComplete;
  onError = config.onTaskError;
}

/** Aggiunge un task alla coda */
export function enqueue(id: string, name: string, fn: () => Promise<unknown> | unknown, opts?: EnqueueOptions): ScheduledTask {
  if (tasks.has(id)) throw new Error(`Task ${id} gia' in coda`);
  const task: ScheduledTask = {
    id, name, fn, priority: opts?.priority ?? 'normal', status: 'pending',
    dependsOn: opts?.dependsOn ?? [], timeoutMs: opts?.timeoutMs ?? defaultTimeout, createdAt: Date.now(),
  };
  tasks.set(id, task);
  scheduleNext();
  return task;
}

/** Cancella un task pendente */
export function cancel(id: string): boolean {
  const task = tasks.get(id);
  if (!task || task.status !== 'pending') return false;
  task.status = 'cancelled';
  task.completedAt = Date.now();
  return true;
}

/** Ritorna un task per ID */
export function getTask(id: string): ScheduledTask | undefined {
  return tasks.get(id);
}

/** Lista task filtrati per status */
export function listTasks(status?: TaskStatus): ScheduledTask[] {
  const all = [...tasks.values()];
  return status ? all.filter(t => t.status === status) : all;
}

/** Statistiche dello scheduler */
export function getStats(): SchedulerStats {
  const all = [...tasks.values()];
  return {
    pending: all.filter(t => t.status === 'pending').length,
    running: all.filter(t => t.status === 'running').length,
    completed: all.filter(t => t.status === 'completed').length,
    failed: all.filter(t => t.status === 'failed').length,
    cancelled: all.filter(t => t.status === 'cancelled').length,
  };
}

/** Verifica dipendenze cicliche (DFS) */
export function hasCyclicDeps(taskId: string): boolean {
  const visited = new Set<string>();
  const walk = (id: string): boolean => {
    if (visited.has(id)) return true;
    visited.add(id);
    const t = tasks.get(id);
    if (!t) return false;
    for (const dep of t.dependsOn) { if (walk(dep)) return true; }
    visited.delete(id);
    return false;
  };
  return walk(taskId);
}

/** Reset completo (per test) */
export function resetScheduler(): void {
  tasks.clear();
  running = 0;
  concurrency = DEFAULT_SCHEDULER_CONFIG.concurrency;
  defaultTimeout = DEFAULT_SCHEDULER_CONFIG.defaultTimeoutMs;
  onComplete = undefined;
  onError = undefined;
}

// --- Internal ---

function depsResolved(task: ScheduledTask): boolean {
  return task.dependsOn.every(depId => {
    const dep = tasks.get(depId);
    return dep && dep.status === 'completed';
  });
}

function getNextTask(): ScheduledTask | null {
  const pending = [...tasks.values()]
    .filter(t => t.status === 'pending' && depsResolved(t))
    .sort((a, b) => PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority] || a.createdAt - b.createdAt);
  return pending[0] ?? null;
}

function scheduleNext(): void {
  while (running < concurrency) {
    const task = getNextTask();
    if (!task) break;
    runTask(task);
  }
}

async function runTask(task: ScheduledTask): Promise<void> {
  task.status = 'running';
  task.startedAt = Date.now();
  running++;

  try {
    const result = await Promise.race([
      Promise.resolve(task.fn()),
      task.timeoutMs ? new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), task.timeoutMs)) : new Promise(() => {}),
    ]);
    if (task.status === 'cancelled') return;
    task.status = 'completed';
    task.result = result;
    onComplete?.(task);
  } catch (err) {
    if (task.status === 'cancelled') return;
    const msg = String(err);
    task.status = msg.includes('Timeout') ? 'timeout' : 'failed';
    task.error = msg;
    onError?.(task);
  } finally {
    task.completedAt = Date.now();
    running--;
    scheduleNext();
  }
}
