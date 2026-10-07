import type {
  OnboardingActivityEntry,
  OnboardingActivityState,
  OperationalStage,
} from "./onboarding";
import type {
  OnboardingNativeProgress,
  OnboardingNativeProgressStage,
} from "./onboarding-runtime";
import { describeError } from "./error-catalog";

const STAGE_VIEW: Record<OnboardingNativeProgressStage, {
  stage: OperationalStage;
  name: string;
}> = {
  engine: { stage: "runtime", name: "Verifica ambiente" },
  runtime: { stage: "runtime", name: "Preparazione runtime" },
  container: { stage: "container", name: "Preparazione container" },
  provider: { stage: "provider", name: "Configurazione provider" },
  login: { stage: "provider-login", name: "Accesso provider" },
  team: { stage: "team-start", name: "Avvio squadra" },
  assistant: { stage: "assistant", name: "Apertura Assistente" },
};

export function activityRuntimeStage(stage: OnboardingNativeProgressStage): OperationalStage {
  return STAGE_VIEW[stage].stage;
}

export function createOnboardingActivity(now = Date.now()): OnboardingActivityState {
  return { startedAt: now, invocation: 0, lastSequence: 0, current: null, events: [] };
}

export function beginOnboardingActivityInvocation(
  current: OnboardingActivityState | null,
  now = Date.now(),
): OnboardingActivityState {
  const state = current ?? createOnboardingActivity(now);
  return { ...state, invocation: state.invocation + 1, lastSequence: 0, current: null };
}

export function applyOnboardingProgress(
  current: OnboardingActivityState | null,
  progress: OnboardingNativeProgress,
  now = Date.now(),
): OnboardingActivityState {
  const initial = current ?? beginOnboardingActivityInvocation(null, now);
  if (progress.sequence <= initial.lastSequence) return initial;
  const view = STAGE_VIEW[progress.stage];
  const existingIndex = initial.events.findIndex((event) =>
    event.invocation === initial.invocation && event.nativeStage === progress.stage,
  );
  const status: OnboardingActivityEntry["status"] = progress.status === "done"
    ? "completed"
    : progress.status === "error" ? "failed" : "active";
  // A failed step is told by the app's catalog from its code, not by the
  // native message.
  const description = progress.status === "error" && progress.code
    ? describeError(progress.code).text
    : progress.message;
  const base: OnboardingActivityEntry = existingIndex >= 0
    ? initial.events[existingIndex]
    : {
        id: `${initial.invocation}:${progress.stage}:${progress.sequence}`,
        invocation: initial.invocation,
        nativeStage: progress.stage,
        sequence: progress.sequence,
        stage: view.stage,
        name: view.name,
        description,
        elapsedMs: Math.max(0, now - initial.startedAt),
        stageElapsedMs: progress.elapsedMs,
        updatedAt: now,
        status,
      };
  const entry: OnboardingActivityEntry = {
    ...base,
    sequence: progress.sequence,
    description,
    elapsedMs: Math.max(0, now - initial.startedAt),
    stageElapsedMs: progress.elapsedMs,
    updatedAt: now,
    status,
  };
  const events = existingIndex >= 0
    ? initial.events.map((event, index) => index === existingIndex ? entry : event)
    : [...initial.events, entry];
  return { ...initial, lastSequence: progress.sequence, current: entry, events };
}
