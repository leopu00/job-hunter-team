import { z } from "zod";

import {
  AnalystWorkerResultSchema,
  type AnalystWorkerResult,
} from "./analyst-contract.js";
import {
  CandidateProfileSchema,
  type CandidateProfile,
} from "./candidate-profile.js";
import {
  RunLimitsSchema,
  ScoutCandidateProposalSchema,
  type RunLimits,
  type ScoutCandidateProposal,
} from "./contract.js";
import {
  API_SCORER_SCALE_VERSION,
  ScorerAuthorizationSchema,
  ScorerWorkerInputSchema,
  type ScorerAuthorization,
  type ScorerWorkerInput,
} from "./scorer-contract.js";

const AuthorizedScorerHandoffSchema = z.strictObject({
  runId: z.string().uuid(),
  scout: ScoutCandidateProposalSchema,
  analystResult: AnalystWorkerResultSchema,
  candidate: CandidateProfileSchema,
  authorization: ScorerAuthorizationSchema,
  limits: RunLimitsSchema,
});

export type AuthorizedScorerHandoff = {
  runId: string;
  scout: ScoutCandidateProposal;
  analystResult: AnalystWorkerResult;
  candidate: CandidateProfile;
  authorization: ScorerAuthorization;
  limits: RunLimits;
};

export function buildAuthorizedScorerInput(
  rawHandoff: AuthorizedScorerHandoff,
): ScorerWorkerInput {
  const handoff = AuthorizedScorerHandoffSchema.parse(rawHandoff);
  return ScorerWorkerInputSchema.parse({
    contractVersion: "1",
    runId: handoff.runId,
    role: "scorer",
    scaleVersion: API_SCORER_SCALE_VERSION,
    scout: handoff.scout,
    analyst: handoff.analystResult.proposal,
    candidate: handoff.candidate,
    authorization: handoff.authorization,
    limits: handoff.limits,
  });
}
