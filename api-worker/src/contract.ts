import { z } from "zod";

const ShortTextSchema = z.string().trim().min(1).max(160);
const SafeIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);

export const WorkModeSchema = z.enum(["remote", "hybrid", "onsite"]);
export const RemoteTypeSchema = z.enum([
  "remote",
  "hybrid",
  "onsite",
  "unspecified",
]);

export const ScoutSearchBriefSchema = z.strictObject({
  targetRoles: z.array(ShortTextSchema).min(1).max(8),
  locations: z.array(ShortTextSchema).min(1).max(12),
  workModes: z.array(WorkModeSchema).min(1).max(3),
  skills: z.array(ShortTextSchema).max(30).default([]),
  postedWithinDays: z.number().int().min(1).max(30).default(7),
  maxCandidates: z.number().int().min(1).max(10).default(3),
});

export const RunLimitsSchema = z.strictObject({
  maxInputTokensPerStep: z.number().int().min(256).max(200_000),
  maxOutputTokensPerStep: z.number().int().min(64).max(16_000),
  maxTotalOutputTokens: z.number().int().min(64).max(64_000),
  maxResultBytes: z.number().int().min(1_024).max(1_000_000),
  maxSteps: z.number().int().min(1).max(20),
  maxToolCalls: z.number().int().min(1).max(50),
  timeoutMs: z.number().int().min(100).max(600_000),
  maxCostUsd: z.number().min(0).max(100),
});

export const ScoutWorkerInputSchema = z.strictObject({
  contractVersion: z.literal("1"),
  runId: z.string().uuid(),
  role: z.literal("scout"),
  search: ScoutSearchBriefSchema,
  limits: RunLimitsSchema,
});

export type ScoutWorkerInput = z.infer<typeof ScoutWorkerInputSchema>;
export type RunLimits = z.infer<typeof RunLimitsSchema>;

export const ScoutCandidateProposalSchema = z.strictObject({
  sourceId: SafeIdentifierSchema,
  title: ShortTextSchema,
  company: ShortTextSchema,
  location: ShortTextSchema,
  remoteType: RemoteTypeSchema,
  url: z
    .string()
    .url()
    .max(2_048)
    .refine((value) => ["https:", "http:"].includes(new URL(value).protocol), {
      message: "Only HTTP(S) job URLs are allowed",
    }),
  source: ShortTextSchema,
  postedAt: z.string().datetime({ offset: true }),
  jdText: z.string().trim().min(80).max(20_000),
  requirements: z.array(ShortTextSchema).min(1).max(40),
  matchedCriteria: z.array(ShortTextSchema).max(20),
  disposition: z.literal("proposed"),
  persistence: z.literal("none"),
});

export type ScoutCandidateProposal = z.infer<
  typeof ScoutCandidateProposalSchema
>;

export const ScoutProposalBatchSchema = z.strictObject({
  proposals: z.array(ScoutCandidateProposalSchema).max(10),
  exhausted: z.boolean(),
  notes: z.array(z.string().trim().min(1).max(240)).max(10),
});

export type ScoutProposalBatch = z.infer<typeof ScoutProposalBatchSchema>;

export const UsageSchema = z.strictObject({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
});

export type Usage = z.infer<typeof UsageSchema>;

export const CostSchema = z.strictObject({
  amountUsd: z.number().nonnegative(),
  estimated: z.boolean(),
});

export const StopReasonSchema = z.enum([
  "completed",
  "no_candidates",
  "provider_stop",
]);

export type StopReason = z.infer<typeof StopReasonSchema>;

export const ScoutWorkerResultSchema = z.strictObject({
  contractVersion: z.literal("1"),
  runId: z.string().uuid(),
  role: z.literal("scout"),
  status: z.literal("completed"),
  disposition: z.literal("proposal_only"),
  persistence: z.literal("none"),
  provider: z.enum(["mock", "anthropic", "openai", "kimi"]),
  model: ShortTextSchema,
  stopReason: StopReasonSchema,
  proposals: z.array(ScoutCandidateProposalSchema).max(10),
  exhausted: z.boolean(),
  notes: z.array(z.string().trim().min(1).max(240)).max(10),
  usage: UsageSchema,
  cost: CostSchema,
  metrics: z.strictObject({
    latencyMs: z.number().int().nonnegative(),
    steps: z.number().int().nonnegative(),
    toolCalls: z.number().int().nonnegative(),
  }),
});

export type ScoutWorkerResult = z.infer<typeof ScoutWorkerResultSchema>;

export const WorkerErrorCodeSchema = z.enum([
  "INPUT_VALIDATION",
  "PROFILE_VALIDATION",
  "CAPABILITY_UNSUPPORTED",
  "LIVE_NOT_ENABLED",
  "LIVE_BUDGET_REQUIRED",
  "API_KEY_MISSING",
  "CONCURRENT_RUN",
  "INPUT_LIMIT",
  "OUTPUT_LIMIT",
  "STEP_LIMIT",
  "TOOL_CALL_LIMIT",
  "BUDGET_EXCEEDED",
  "TIMEOUT",
  "TOOL_ERROR",
  "PROVIDER_ERROR",
  "OUTPUT_VALIDATION",
  "INTERNAL_ERROR",
]);

export type WorkerErrorCode = z.infer<typeof WorkerErrorCodeSchema>;

export const ScoutWorkerErrorSchema = z.strictObject({
  contractVersion: z.literal("1"),
  runId: z.string().uuid().optional(),
  role: z.literal("scout"),
  code: WorkerErrorCodeSchema,
  message: z.string().trim().min(1).max(240),
  retryable: z.boolean(),
  limit: z
    .enum([
      "input_tokens_per_step",
      "output_tokens_per_step",
      "total_output_tokens",
      "result_bytes",
      "steps",
      "tool_calls",
      "timeout_ms",
      "cost_usd",
      "concurrency",
    ])
    .optional(),
});

export type ScoutWorkerError = z.infer<typeof ScoutWorkerErrorSchema>;

export const ScoutWorkerOutcomeSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), result: ScoutWorkerResultSchema }),
  z.strictObject({ ok: z.literal(false), error: ScoutWorkerErrorSchema }),
]);

export type ScoutWorkerOutcome = z.infer<typeof ScoutWorkerOutcomeSchema>;

export const ScoutToolNameSchema = z.enum(["search_jobs", "read_job"]);

export const ToolEventSchema = z.strictObject({
  contractVersion: z.literal("1"),
  event: z.literal("tool"),
  phase: z.enum(["started", "completed", "failed"]),
  timestamp: z.string().datetime({ offset: true }),
  runId: z.string().uuid(),
  toolName: ScoutToolNameSchema,
  toolCallId: SafeIdentifierSchema,
  durationMs: z.number().int().nonnegative().optional(),
});

export type ToolEvent = z.infer<typeof ToolEventSchema>;

const AuditCommonSchema = z.strictObject({
  contractVersion: z.literal("1"),
  timestamp: z.string().datetime({ offset: true }),
  runId: z.string().uuid().optional(),
});

export const RunStartedEventSchema = AuditCommonSchema.extend({
  event: z.literal("run_started"),
  provider: z.enum(["mock", "anthropic", "openai", "kimi"]),
  model: ShortTextSchema,
});

export const ProviderStepEventSchema = AuditCommonSchema.extend({
  event: z.literal("provider_step"),
  provider: z.enum(["mock", "anthropic", "openai", "kimi"]),
  model: ShortTextSchema,
  step: z.number().int().positive(),
  latencyMs: z.number().int().nonnegative(),
  usage: UsageSchema,
  cost: CostSchema,
  stopReason: z.string().trim().min(1).max(80),
});

export const RunCompletedEventSchema = AuditCommonSchema.extend({
  event: z.literal("run_completed"),
  provider: z.enum(["mock", "anthropic", "openai", "kimi"]),
  model: ShortTextSchema,
  latencyMs: z.number().int().nonnegative(),
  usage: UsageSchema,
  cost: CostSchema,
  toolCalls: z.number().int().nonnegative(),
  steps: z.number().int().nonnegative(),
  stopReason: StopReasonSchema,
  proposalCount: z.number().int().nonnegative(),
});

export const RunFailedEventSchema = AuditCommonSchema.extend({
  event: z.literal("run_failed"),
  provider: z.enum(["mock", "anthropic", "openai", "kimi"]).optional(),
  model: ShortTextSchema.optional(),
  latencyMs: z.number().int().nonnegative(),
  errorCode: WorkerErrorCodeSchema,
  retryable: z.boolean(),
  limit: ScoutWorkerErrorSchema.shape.limit,
});

export const AuditEventSchema = z.union([
  ToolEventSchema,
  RunStartedEventSchema,
  ProviderStepEventSchema,
  RunCompletedEventSchema,
  RunFailedEventSchema,
]);

export type AuditEvent = z.infer<typeof AuditEventSchema>;
