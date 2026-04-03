/**
 * Validatori task — Zod schemas
 *
 * Schema per TaskRecord, CreateTaskParams, UpdateTaskParams,
 * TaskRegistrySummary, e store snapshot.
 */

import { z } from "zod";
import {
  nonEmptyString,
  optionalString,
  uuid,
  timestampMs,
  optionalTimestamp,
  nonNegativeInt,
  enumFromValues,
  validate,
  type ValidationResult,
} from "./common.js";

// ── Enum ───────────────────────────────────────────────────────────────────

const TASK_RUNTIMES = ["subagent", "cli", "cron"] as const;
const TASK_STATUSES = ["queued", "running", "succeeded", "failed", "timed_out", "cancelled", "lost"] as const;
const NOTIFY_POLICIES = ["done_only", "state_changes", "silent"] as const;
const TERMINAL_OUTCOMES = ["succeeded", "blocked"] as const;
const SCOPE_KINDS = ["session", "system"] as const;

export const TaskRuntimeSchema = enumFromValues(TASK_RUNTIMES);
export const TaskStatusSchema = enumFromValues(TASK_STATUSES);
export const TaskNotifyPolicySchema = enumFromValues(NOTIFY_POLICIES);
export const TaskTerminalOutcomeSchema = enumFromValues(TERMINAL_OUTCOMES);
export const TaskScopeKindSchema = enumFromValues(SCOPE_KINDS);

// ── TaskRecord ─────────────────────────────────────────────────────────────

export const TaskRecordSchema = z.object({
  taskId: uuid,
  runtime: TaskRuntimeSchema,
  ownerKey: nonEmptyString,
  scopeKind: TaskScopeKindSchema,
  agentId: optionalString,
  label: optionalString,
  task: nonEmptyString,
  status: TaskStatusSchema,
  notifyPolicy: TaskNotifyPolicySchema,
  createdAt: timestampMs,
  startedAt: optionalTimestamp,
  endedAt: optionalTimestamp,
  lastEventAt: optionalTimestamp,
  error: z.string().optional(),
  progressSummary: z.string().optional(),
  terminalSummary: z.string().optional(),
  terminalOutcome: TaskTerminalOutcomeSchema.optional(),
});

// ── Input operazioni ───────────────────────────────────────────────────────

export const CreateTaskInput = z.object({
  runtime: TaskRuntimeSchema,
  ownerKey: nonEmptyString,
  task: nonEmptyString,
  scopeKind: TaskScopeKindSchema.default("session"),
  agentId: optionalString,
  label: optionalString,
  notifyPolicy: TaskNotifyPolicySchema.default("done_only"),
  status: TaskStatusSchema.default("queued"),
});

export const UpdateTaskInput = z.object({
  status: TaskStatusSchema.optional(),
  progressSummary: z.string().optional(),
  terminalSummary: z.string().optional(),
  terminalOutcome: TaskTerminalOutcomeSchema.optional(),
  error: z.string().optional(),
}).refine(
  (d) => Object.values(d).some((v) => v !== undefined),
  { message: "Almeno un campo deve essere specificato" },
);

// ── TaskEvent ──────────────────────────────────────────────────────────────

const TASK_EVENT_KINDS = [...TASK_STATUSES, "progress"] as const;
export const TaskEventKindSchema = enumFromValues(TASK_EVENT_KINDS);

export const TaskEventRecordSchema = z.object({
  at: timestampMs,
  kind: TaskEventKindSchema,
  summary: z.string().optional(),
});

// ── Summary e aggregazione ─────────────────────────────────────────────────

export const TaskStatusCountsSchema = z.object({
  queued: nonNegativeInt,
  running: nonNegativeInt,
  succeeded: nonNegativeInt,
  failed: nonNegativeInt,
  timed_out: nonNegativeInt,
  cancelled: nonNegativeInt,
  lost: nonNegativeInt,
});

export const TaskRuntimeCountsSchema = z.object({
  subagent: nonNegativeInt,
  cli: nonNegativeInt,
  cron: nonNegativeInt,
});

export const TaskRegistrySummarySchema = z.object({
  total: nonNegativeInt,
  active: nonNegativeInt,
  terminal: nonNegativeInt,
  failures: nonNegativeInt,
  byStatus: TaskStatusCountsSchema,
  byRuntime: TaskRuntimeCountsSchema,
});

// ── Store snapshot ─────────────────────────────────────────────────────────

export const TaskStoreSnapshotSchema = z.object({
  version: z.literal(1),
  updatedAt: timestampMs,
  tasks: z.array(TaskRecordSchema),
});

// ── Funzioni di validazione ────────────────────────────────────────────────

export function validateTaskRecord(data: unknown): ValidationResult<z.infer<typeof TaskRecordSchema>> {
  return validate(TaskRecordSchema, data);
}

export function validateCreateTask(data: unknown): ValidationResult<z.infer<typeof CreateTaskInput>> {
  return validate(CreateTaskInput, data);
}

export function validateUpdateTask(data: unknown): ValidationResult<z.infer<typeof UpdateTaskInput>> {
  return validate(UpdateTaskInput, data);
}

export function validateTaskSnapshot(data: unknown): ValidationResult<z.infer<typeof TaskStoreSnapshotSchema>> {
  return validate(TaskStoreSnapshotSchema, data);
}
