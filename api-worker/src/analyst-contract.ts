import { z } from "zod";

import { CandidateProfileSchema } from "./candidate-profile.js";
import {
  CostSchema,
  RunLimitsSchema,
  ScoutCandidateProposalSchema,
  UsageSchema,
  WorkerErrorCodeSchema,
} from "./contract.js";

const ShortTextSchema = z.string().trim().min(1).max(240);
const LongTextSchema = z.string().trim().min(1).max(4_000);

export const AnalystExclusionTagSchema = z.enum([
  "DEAD_LINK",
  "GEO",
  "LANGUAGE",
  "SENIORITY",
  "STACK",
  "DEGREE",
  "CERT",
  "SCAM",
]);

export const AnalystWorkerInputSchema = z.strictObject({
  contractVersion: z.literal("1"),
  runId: z.string().uuid(),
  role: z.literal("analyst"),
  position: ScoutCandidateProposalSchema,
  candidate: CandidateProfileSchema,
  activeRoleFamilies: z.array(ShortTextSchema).max(20).default([]),
  limits: RunLimitsSchema,
});

export type AnalystWorkerInput = z.infer<typeof AnalystWorkerInputSchema>;

export const AnalystProposalSchema = z
  .strictObject({
    sourceId: z.string().trim().min(1).max(100),
    url: z.string().url().max(2_048),
    decision: z.enum(["checked", "excluded"]),
    exclusionTag: AnalystExclusionTagSchema.optional(),
    structuredRequirements: z.strictObject({
      experienceRequiredYears: z.number().min(0).max(80).nullable(),
      experienceType: z.enum(["mandatory", "preferred", "not_specified"]),
      degree: z.enum([
        "mandatory",
        "preferred",
        "not_required",
        "or_equivalent",
        "not_specified",
      ]),
      languagesRequired: z.array(ShortTextSchema).max(12),
      seniority: z.enum(["junior", "mid", "senior", "lead", "not_specified"]),
    }),
    mismatchTags: z.array(AnalystExclusionTagSchema).max(8),
    teamNote: LongTextSchema,
    jdSummary: LongTextSchema,
    roleFamily: ShortTextSchema,
    location: z.strictObject({
      city: ShortTextSchema.nullable(),
      country: ShortTextSchema,
      countryCode: z
        .string()
        .trim()
        .regex(/^[A-Z]{2}$/),
      workMode: z.enum(["remote", "hybrid", "onsite", "unspecified"]),
    }),
    salaryEstimate: z
      .strictObject({
        minimum: z.number().nonnegative(),
        maximum: z.number().nonnegative(),
        currency: z
          .string()
          .trim()
          .regex(/^[A-Z]{3}$/),
        period: z.enum(["year", "month", "hour"]),
        confidence: z.enum(["low", "medium", "high"]),
      })
      .refine((salary) => salary.maximum >= salary.minimum, {
        message: "Salary maximum must be at least the minimum",
      })
      .optional(),
    company: z.strictObject({
      name: ShortTextSchema,
      hqCountry: ShortTextSchema.optional(),
      sector: ShortTextSchema.optional(),
      reviewRating: z.number().min(1).max(5).optional(),
      redFlags: z.array(ShortTextSchema).max(10),
      cultureNotes: z.array(ShortTextSchema).max(10),
      verdict: z.enum(["GO", "CAUTIOUS", "NO_GO"]),
    }),
    highlights: z
      .array(
        z.strictObject({
          type: z.enum(["pro", "con"]),
          text: ShortTextSchema,
        }),
      )
      .max(3),
    disposition: z.literal("proposed"),
    persistence: z.literal("none"),
  })
  .superRefine((proposal, context) => {
    if (proposal.decision === "excluded" && !proposal.exclusionTag) {
      context.addIssue({
        code: "custom",
        path: ["exclusionTag"],
        message: "Excluded proposals require one canonical exclusion tag",
      });
    }
    if (proposal.decision === "checked" && proposal.exclusionTag) {
      context.addIssue({
        code: "custom",
        path: ["exclusionTag"],
        message: "Checked proposals cannot carry an exclusion tag",
      });
    }
  });

export type AnalystProposal = z.infer<typeof AnalystProposalSchema>;

export const AnalystWorkerResultSchema = z.strictObject({
  contractVersion: z.literal("1"),
  runId: z.string().uuid(),
  role: z.literal("analyst"),
  status: z.literal("completed"),
  disposition: z.literal("proposal_only"),
  persistence: z.literal("none"),
  provider: z.enum(["mock", "anthropic", "openai", "kimi"]),
  model: ShortTextSchema,
  proposal: AnalystProposalSchema,
  usage: UsageSchema,
  cost: CostSchema,
  metrics: z.strictObject({
    latencyMs: z.number().int().nonnegative(),
    steps: z.number().int().nonnegative(),
    providerRequests: z.number().int().nonnegative(),
    toolCalls: z.number().int().nonnegative(),
    webSearchCalls: z.number().int().nonnegative(),
  }),
});

export type AnalystWorkerResult = z.infer<typeof AnalystWorkerResultSchema>;

export const AnalystWorkerErrorSchema = z.strictObject({
  contractVersion: z.literal("1"),
  runId: z.string().uuid().optional(),
  role: z.literal("analyst"),
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

export const AnalystWorkerOutcomeSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), result: AnalystWorkerResultSchema }),
  z.strictObject({ ok: z.literal(false), error: AnalystWorkerErrorSchema }),
]);

export type AnalystWorkerOutcome = z.infer<typeof AnalystWorkerOutcomeSchema>;
