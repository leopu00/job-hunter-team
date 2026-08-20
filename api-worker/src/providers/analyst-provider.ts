import type {
  AnalystProposal,
  AnalystWorkerInput,
} from "../analyst-contract.js";
import type { RunGuard, StepReservation } from "../guardrails.js";
import type { ModelProfile } from "../model-profile.js";
import type { ProviderStepRecord } from "./provider.js";

export type AnalystProviderContext = {
  input: AnalystWorkerInput;
  profile: ModelProfile;
  systemPrompt: string;
  prompt: string;
  guard: RunGuard;
  signal: AbortSignal;
  recordRequestStarted(reservation: StepReservation): Promise<void>;
  recordRequestFailed(
    reservation: StepReservation,
    failureReason: string,
  ): Promise<void>;
  recordStep(record: ProviderStepRecord): Promise<void>;
};

export type AnalystProviderExecution = {
  output: AnalystProposal;
  rawStopReason: string;
};

export interface AnalystProviderAdapter {
  run(context: AnalystProviderContext): Promise<AnalystProviderExecution>;
}
