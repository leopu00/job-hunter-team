/**
 * Task Registry — gestione task in memoria
 *
 * Registry in-memory con CRUD, indici per ownerKey/agentId,
 * e aggregazione summary. Persistenza delegata a task-store.
 */

import { randomUUID } from "node:crypto";
import type {
  TaskRecord,
  TaskRuntime,
  TaskStatus,
  TaskNotifyPolicy,
  TaskScopeKind,
  TaskTerminalOutcome,
  TaskRegistrySummary,
  TaskStatusCounts,
  TaskRuntimeCounts,
} from "./types.js";
import { isTerminalStatus, isActiveStatus } from "./types.js";

const tasks = new Map<string, TaskRecord>();
const taskIdsByOwnerKey = new Map<string, Set<string>>();
const taskIdsByAgentId = new Map<string, Set<string>>();

function addToIndex(index: Map<string, Set<string>>, key: string | undefined, taskId: string) {
  if (!key) return;
  let set = index.get(key);
  if (!set) { set = new Set(); index.set(key, set); }
  set.add(taskId);
}

function removeFromIndex(index: Map<string, Set<string>>, key: string | undefined, taskId: string) {
  if (!key) return;
  const set = index.get(key);
  if (!set) return;
  set.delete(taskId);
  if (set.size === 0) index.delete(key);
}

function indexTask(record: TaskRecord) {
  addToIndex(taskIdsByOwnerKey, record.ownerKey, record.taskId);
  addToIndex(taskIdsByAgentId, record.agentId, record.taskId);
}

function unindexTask(record: TaskRecord) {
  removeFromIndex(taskIdsByOwnerKey, record.ownerKey, record.taskId);
  removeFromIndex(taskIdsByAgentId, record.agentId, record.taskId);
}

export type CreateTaskParams = {
  runtime: TaskRuntime;
  ownerKey: string;
  task: string;
  scopeKind?: TaskScopeKind;
  agentId?: string;
  label?: string;
  notifyPolicy?: TaskNotifyPolicy;
  status?: TaskStatus;
};

export function createTask(params: CreateTaskParams): TaskRecord {
  const now = Date.now();
  const status = params.status ?? "queued";
  const record: TaskRecord = {
    taskId: randomUUID(),
    runtime: params.runtime,
    ownerKey: params.ownerKey.trim(),
    scopeKind: params.scopeKind ?? "session",
    agentId: params.agentId?.trim(),
    label: params.label?.trim(),
    task: params.task,
    status,
    notifyPolicy: params.notifyPolicy ?? "done_only",
    createdAt: now,
    lastEventAt: now,
    startedAt: status === "running" ? now : undefined,
  };
  tasks.set(record.taskId, record);
  indexTask(record);
  return { ...record };
}

export function getTaskById(taskId: string): TaskRecord | undefined {
  const record = tasks.get(taskId);
  return record ? { ...record } : undefined;
}

export function listTasks(): TaskRecord[] {
  return [...tasks.values()].map((r) => ({ ...r }));
}

export function listTasksByOwner(ownerKey: string): TaskRecord[] {
  const ids = taskIdsByOwnerKey.get(ownerKey);
  if (!ids) return [];
  return [...ids].map((id) => tasks.get(id)!).filter(Boolean).map((r) => ({ ...r }));
}

export function listTasksByAgent(agentId: string): TaskRecord[] {
  const ids = taskIdsByAgentId.get(agentId);
  if (!ids) return [];
  return [...ids].map((id) => tasks.get(id)!).filter(Boolean).map((r) => ({ ...r }));
}

export type UpdateTaskParams = {
  status?: TaskStatus;
  progressSummary?: string;
  terminalSummary?: string;
  terminalOutcome?: TaskTerminalOutcome;
  error?: string;
};

export function updateTask(taskId: string, params: UpdateTaskParams): TaskRecord | undefined {
  const record = tasks.get(taskId);
  if (!record) return undefined;

  const now = Date.now();
  if (params.status) {
    record.status = params.status;
    record.lastEventAt = now;
    if (params.status === "running" && !record.startedAt) {
      record.startedAt = now;
    }
    if (isTerminalStatus(params.status)) {
      record.endedAt = now;
    }
  }
  if (params.progressSummary !== undefined) record.progressSummary = params.progressSummary;
  if (params.terminalSummary !== undefined) record.terminalSummary = params.terminalSummary;
  if (params.terminalOutcome !== undefined) record.terminalOutcome = params.terminalOutcome;
  if (params.error !== undefined) record.error = params.error;

  return { ...record };
}

export function cancelTask(taskId: string): TaskRecord | undefined {
  const record = tasks.get(taskId);
  if (!record || !isActiveStatus(record.status)) return undefined;
  return updateTask(taskId, { status: "cancelled" });
}

export function deleteTask(taskId: string): boolean {
  const record = tasks.get(taskId);
  if (!record) return false;
  unindexTask(record);
  tasks.delete(taskId);
  return true;
}

function emptyStatusCounts(): TaskStatusCounts {
  return { queued: 0, running: 0, succeeded: 0, failed: 0, timed_out: 0, cancelled: 0, lost: 0 };
}

function emptyRuntimeCounts(): TaskRuntimeCounts {
  return { subagent: 0, cli: 0, cron: 0 };
}

export function getRegistrySummary(): TaskRegistrySummary {
  const summary: TaskRegistrySummary = {
    total: 0, active: 0, terminal: 0, failures: 0,
    byStatus: emptyStatusCounts(),
    byRuntime: emptyRuntimeCounts(),
  };
  for (const task of tasks.values()) {
    summary.total++;
    summary.byStatus[task.status]++;
    summary.byRuntime[task.runtime]++;
    if (isActiveStatus(task.status)) summary.active++;
    else summary.terminal++;
    if (task.status === "failed" || task.status === "timed_out" || task.status === "lost") {
      summary.failures++;
    }
  }
  return summary;
}

export function restoreFromSnapshot(records: TaskRecord[]): void {
  clearRegistry();
  for (const record of records) {
    tasks.set(record.taskId, { ...record });
    indexTask(record);
  }
}

export function exportSnapshot(): TaskRecord[] {
  return [...tasks.values()].map((r) => ({ ...r }));
}

export function clearRegistry(): void {
  tasks.clear();
  taskIdsByOwnerKey.clear();
  taskIdsByAgentId.clear();
}

export function taskCount(): number {
  return tasks.size;
}
