/**
 * Task system — Tipi core
 *
 * Gestione task per agenti: creazione, assegnazione, tracking.
 * Lifecycle: queued → running → succeeded/failed/timed_out/cancelled/lost
 */

// ── Runtime e Status ───────────────────────────────────────────────────────

/** Ambiente di esecuzione del task */
export type TaskRuntime = "subagent" | "cli" | "cron";

/** Stato del task nel suo lifecycle */
export type TaskStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "cancelled"
  | "lost";

/** Policy di notifica al richiedente */
export type TaskNotifyPolicy = "done_only" | "state_changes" | "silent";

/** Esito terminale (solo per task completati) */
export type TaskTerminalOutcome = "succeeded" | "blocked";

/** Scope del task */
export type TaskScopeKind = "session" | "system";

// ── Record ─────────────────────────────────────────────────────────────────

/** Record completo di un task */
export type TaskRecord = {
  taskId: string;
  runtime: TaskRuntime;
  ownerKey: string;
  scopeKind: TaskScopeKind;
  agentId?: string;
  label?: string;
  task: string;
  status: TaskStatus;
  notifyPolicy: TaskNotifyPolicy;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  lastEventAt?: number;
  error?: string;
  progressSummary?: string;
  terminalSummary?: string;
  terminalOutcome?: TaskTerminalOutcome;
};

// ── Event tracking ─────────────────────────────────────────────────────────

/** Tipo di evento nel lifecycle del task */
export type TaskEventKind = TaskStatus | "progress";

/** Singolo evento registrato */
export type TaskEventRecord = {
  at: number;
  kind: TaskEventKind;
  summary?: string;
};

// ── Aggregazione ───────────────────────────────────────────────────────────

/** Conteggi per status */
export type TaskStatusCounts = Record<TaskStatus, number>;

/** Conteggi per runtime */
export type TaskRuntimeCounts = Record<TaskRuntime, number>;

/** Riepilogo aggregato del registry */
export type TaskRegistrySummary = {
  total: number;
  active: number;
  terminal: number;
  failures: number;
  byStatus: TaskStatusCounts;
  byRuntime: TaskRuntimeCounts;
};

// ── Helpers ────────────────────────────────────────────────────────────────

/** Stati terminali (non piu' attivi) */
export const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set([
  "succeeded",
  "failed",
  "timed_out",
  "cancelled",
  "lost",
]);

/** Stati attivi */
export const ACTIVE_STATUSES: ReadonlySet<TaskStatus> = new Set([
  "queued",
  "running",
]);

/** Verifica se uno status e' terminale */
export function isTerminalStatus(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** Verifica se uno status e' attivo */
export function isActiveStatus(status: TaskStatus): boolean {
  return ACTIVE_STATUSES.has(status);
}
