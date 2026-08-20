import type {
  ScoutProposalBatch,
  ScoutWorkerInput,
  Usage,
} from "../contract.js";
import type { RunGuard, StepReservation } from "../guardrails.js";
import type { ModelProfile } from "../model-profile.js";
import type { GuardedScoutTools } from "../tools.js";

export type ProviderStepRecord = {
  reservation: StepReservation;
  usage: Usage;
  finishReason: string;
  webSearchCalls?: number;
  responseId?: string;
};

export type ProviderExecutionContext = {
  input: ScoutWorkerInput;
  profile: ModelProfile;
  systemPrompt: string;
  prompt: string;
  tools: GuardedScoutTools;
  guard: RunGuard;
  discoveryMode: "catalog" | "web";
  signal: AbortSignal;
  recordRequestStarted(reservation: StepReservation): Promise<void>;
  recordRequestFailed(
    reservation: StepReservation,
    failureReason: string,
  ): Promise<void>;
  recordStep(record: ProviderStepRecord): Promise<void>;
};

export type ProviderExecution = {
  output: ScoutProposalBatch;
  rawStopReason: string;
};

export interface ScoutProviderAdapter {
  run(context: ProviderExecutionContext): Promise<ProviderExecution>;
}
