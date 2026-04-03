/**
 * Modulo tasks — gestione task per agenti
 *
 * Creazione, assegnazione, tracking e persistenza task.
 */

// Tipi
export type {
  TaskRuntime,
  TaskStatus,
  TaskNotifyPolicy,
  TaskTerminalOutcome,
  TaskScopeKind,
  TaskRecord,
  TaskEventKind,
  TaskEventRecord,
  TaskStatusCounts,
  TaskRuntimeCounts,
  TaskRegistrySummary,
} from "./types.js";

export {
  TERMINAL_STATUSES,
  ACTIVE_STATUSES,
  isTerminalStatus,
  isActiveStatus,
} from "./types.js";

// Registry
export type { CreateTaskParams, UpdateTaskParams } from "./task-registry.js";

export {
  createTask,
  getTaskById,
  listTasks,
  listTasksByOwner,
  listTasksByAgent,
  updateTask,
  cancelTask,
  deleteTask,
  getRegistrySummary,
  restoreFromSnapshot,
  exportSnapshot,
  clearRegistry,
  taskCount,
} from "./task-registry.js";

// Store
export {
  configureTaskStore,
  getStoreFilePath,
  saveTasks,
  loadTasks,
  hasStoredTasks,
  saveTasksToPath,
  loadTasksFromPath,
} from "./task-store.js";
