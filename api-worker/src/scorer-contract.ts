import { z } from "zod";

import { AnalystProposalSchema } from "./analyst-contract.js";
import { CandidateProfileSchema } from "./candidate-profile.js";
import { RunLimitsSchema, ScoutCandidateProposalSchema } from "./contract.js";

const Id = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
const Rationale = z.string().trim().min(1).max(1_000);

export const API_SCORER_SCALE_VERSION = "jht-100-v2" as const;
export const API_SCORER_COMPONENT_LIMITS = Object.freeze({
  stackMatch: 35,
  experienceFit: 25,
  remoteFit: 20,
  salaryFit: 10,
  strategicFit: 10,
});
export const API_SCORER_TOTAL_LIMIT = 100;
export const API_SCORER_PIPELINE_THRESHOLD = 40;

export const ScorerAuthorizationSchema = z.strictObject({
  authorizationVersion: z.literal("1"),
  authorized: z.literal(true),
  scope: z.literal("score_position"),
  authorizationId: Id,
  sourceId: Id,
  authorizedBy: Id,
  authorizedAt: z.string().datetime({ offset: true }),
});
export type ScorerAuthorization = z.infer<typeof ScorerAuthorizationSchema>;

export const ScorerWorkerInputSchema = z
  .strictObject({
    contractVersion: z.literal("1"),
    runId: z.string().uuid(),
    role: z.literal("scorer"),
    scaleVersion: z.literal(API_SCORER_SCALE_VERSION),
    scout: ScoutCandidateProposalSchema,
    analyst: AnalystProposalSchema,
    candidate: CandidateProfileSchema,
    authorization: ScorerAuthorizationSchema,
    limits: RunLimitsSchema,
  })
  .superRefine((input, context) => {
    const identities = [
      input.scout.sourceId,
      input.analyst.sourceId,
      input.authorization.sourceId,
    ];
    if (new Set(identities).size !== 1) {
      context.addIssue({
        code: "custom",
        path: ["authorization", "sourceId"],
        message: "Scout, Analyst and authorization identities must match",
      });
    }
    if (input.scout.url !== input.analyst.url) {
      context.addIssue({
        code: "custom",
        path: ["analyst", "url"],
        message: "Scout and Analyst URLs must match",
      });
    }
    if (input.analyst.decision !== "checked") {
      context.addIssue({
        code: "custom",
        path: ["analyst", "decision"],
        message: "Only checked Analyst proposals may be scored",
      });
    }
  });
export type ScorerWorkerInput = z.infer<typeof ScorerWorkerInputSchema>;

const ScorerComponentsSchema = z.strictObject({
  stackMatch: z
    .number()
    .int()
    .min(0)
    .max(API_SCORER_COMPONENT_LIMITS.stackMatch),
  experienceFit: z
    .number()
    .int()
    .min(0)
    .max(API_SCORER_COMPONENT_LIMITS.experienceFit),
  remoteFit: z.number().int().min(0).max(API_SCORER_COMPONENT_LIMITS.remoteFit),
  salaryFit: z.number().int().min(0).max(API_SCORER_COMPONENT_LIMITS.salaryFit),
  strategicFit: z
    .number()
    .int()
    .min(0)
    .max(API_SCORER_COMPONENT_LIMITS.strategicFit),
});

export const ScorerProposalSchema = z
  .strictObject({
    sourceId: Id,
    url: z.string().url().max(2_048),
    scaleVersion: z.literal(API_SCORER_SCALE_VERSION),
    components: ScorerComponentsSchema,
    deductions: z
      .array(
        z.strictObject({
          code: z.enum([
            "missing_required_experience",
            "location_constraint",
            "degree_constraint",
            "language_constraint",
            "salary_uncertainty",
            "evidence_uncertainty",
          ]),
          points: z.number().int().min(1).max(30),
          reason: Rationale,
        }),
      )
      .max(6),
    totalScore: z.number().int().min(0).max(API_SCORER_TOTAL_LIMIT),
    decision: z.enum(["scored", "excluded"]),
    rationale: z.strictObject({
      stackMatch: Rationale,
      experienceFit: Rationale,
      remoteFit: Rationale,
      salaryFit: Rationale,
      strategicFit: Rationale,
      summary: Rationale,
    }),
    disposition: z.literal("proposed"),
    persistence: z.literal("none"),
  })
  .superRefine((proposal, context) => {
    const deductionCodes = proposal.deductions.map((item) => item.code);
    if (new Set(deductionCodes).size !== deductionCodes.length) {
      context.addIssue({
        code: "custom",
        path: ["deductions"],
        message: "Deduction codes must be unique",
      });
    }
    const componentTotal = Object.values(proposal.components).reduce(
      (sum, value) => sum + value,
      0,
    );
    const deductionTotal = proposal.deductions.reduce(
      (sum, item) => sum + item.points,
      0,
    );
    if (deductionTotal > 30) {
      context.addIssue({
        code: "custom",
        path: ["deductions"],
        message: "Combined deductions cannot exceed 30 points",
      });
    }
    const expectedTotal = Math.max(0, componentTotal - deductionTotal);
    if (proposal.totalScore !== expectedTotal) {
      context.addIssue({
        code: "custom",
        path: ["totalScore"],
        message: `totalScore must equal ${expectedTotal}`,
      });
    }
    const expectedDecision =
      expectedTotal < API_SCORER_PIPELINE_THRESHOLD ? "excluded" : "scored";
    if (proposal.decision !== expectedDecision) {
      context.addIssue({
        code: "custom",
        path: ["decision"],
        message: `decision must be ${expectedDecision}`,
      });
    }
  });
export type ScorerProposal = z.infer<typeof ScorerProposalSchema>;

// Provider-native strict JSON Schema implementations support a narrower
// keyword subset than Zod. Keep this transport schema structural and apply the
// full URL, range, cardinality, arithmetic and threshold validation above once
// the response is local. This is not a weaker worker boundary: only the final
// ScorerProposalSchema result can leave the worker.
export const ScorerProviderOutputSchema = z.strictObject({
  sourceId: z.string(),
  url: z.string(),
  scaleVersion: z.literal(API_SCORER_SCALE_VERSION),
  components: z.strictObject({
    stackMatch: z.number(),
    experienceFit: z.number(),
    remoteFit: z.number(),
    salaryFit: z.number(),
    strategicFit: z.number(),
  }),
  deductions: z.array(
    z.strictObject({
      code: z.enum([
        "missing_required_experience",
        "location_constraint",
        "degree_constraint",
        "language_constraint",
        "salary_uncertainty",
        "evidence_uncertainty",
      ]),
      points: z.number(),
      reason: z.string(),
    }),
  ),
  totalScore: z.number(),
  decision: z.enum(["scored", "excluded"]),
  rationale: z.strictObject({
    stackMatch: z.string(),
    experienceFit: z.string(),
    remoteFit: z.string(),
    salaryFit: z.string(),
    strategicFit: z.string(),
    summary: z.string(),
  }),
  disposition: z.literal("proposed"),
  persistence: z.literal("none"),
});

export function scorerComponentTotal(
  components: ScorerProposal["components"],
): number {
  return Object.values(components).reduce((sum, value) => sum + value, 0);
}
