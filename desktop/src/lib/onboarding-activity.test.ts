import { describe, expect, it } from "vitest";
import type { OnboardingNativeProgress } from "./onboarding-runtime";
import {
  activityRuntimeStage,
  applyOnboardingProgress,
  beginOnboardingActivityInvocation,
  createOnboardingActivity,
} from "./onboarding-activity";

function progress(
  overrides: Partial<OnboardingNativeProgress> = {},
): OnboardingNativeProgress {
  return {
    stage: "runtime",
    status: "start",
    message: "Preparo il runtime verificato.",
    sequence: 1,
    elapsedMs: 0,
    code: null,
    retryable: null,
    ...overrides,
  };
}

describe("onboarding activity timeline", () => {
  it("maps native stages to the existing verified UI steps", () => {
    expect(activityRuntimeStage("engine")).toBe("runtime");
    expect(activityRuntimeStage("runtime")).toBe("runtime");
    expect(activityRuntimeStage("container")).toBe("container");
    expect(activityRuntimeStage("login")).toBe("provider-login");
    expect(activityRuntimeStage("team")).toBe("team-start");
    expect(activityRuntimeStage("assistant")).toBe("assistant");
  });

  it("coalesces heartbeats and keeps backend elapsed time without inventing percentages", () => {
    let state = beginOnboardingActivityInvocation(createOnboardingActivity(1_000), 1_000);
    state = applyOnboardingProgress(state, progress(), 1_000);
    state = applyOnboardingProgress(state, progress({
      status: "progress",
      sequence: 2,
      elapsedMs: 2_000,
      message: "Download verificato in corso.",
    }), 3_000);

    expect(state.events).toHaveLength(1);
    expect(state.current).toMatchObject({
      name: "Preparazione runtime",
      description: "Download verificato in corso.",
      sequence: 2,
      stageElapsedMs: 2_000,
      elapsedMs: 2_000,
      status: "active",
    });
    expect(state.current).not.toHaveProperty("progress");
    expect(state.current).not.toHaveProperty("percent");
    expect(state.current).not.toHaveProperty("eta");
  });

  it("orders invocations independently, ignores stale sequence values and records terminals", () => {
    let state = beginOnboardingActivityInvocation(createOnboardingActivity(10), 10);
    state = applyOnboardingProgress(state, progress(), 10);
    const unchanged = applyOnboardingProgress(state, progress({ sequence: 1, message: "stale" }), 20);
    expect(unchanged).toBe(state);

    state = applyOnboardingProgress(state, progress({ status: "done", sequence: 2, elapsedMs: 8 }), 20);
    expect(state.current?.status).toBe("completed");

    state = beginOnboardingActivityInvocation(state, 30);
    state = applyOnboardingProgress(state, progress({
      stage: "team",
      status: "error",
      message: "Avvio squadra non riuscito.",
      code: "team_start_failed",
      retryable: true,
    }), 40);

    expect(state.events).toHaveLength(2);
    expect(state.current).toMatchObject({
      invocation: 2,
      name: "Avvio squadra",
      status: "failed",
    });
  });

  it("replays a failed container attempt and a separate explicit retry deterministically", () => {
    let state = beginOnboardingActivityInvocation(createOnboardingActivity(1_000), 1_000);
    state = applyOnboardingProgress(state, progress({
      stage: "runtime", status: "done", message: "Runtime verificato.",
      sequence: 1, elapsedMs: 700,
    }), 1_700);
    state = applyOnboardingProgress(state, progress({
      stage: "container", status: "start", message: "Avvio il container del team.",
      sequence: 2, elapsedMs: 0,
    }), 1_800);
    state = applyOnboardingProgress(state, progress({
      stage: "container", status: "error", message: "Il container non si è avviato.",
      sequence: 3, elapsedMs: 2_400, code: "container_start_failed", retryable: true,
    }), 4_200);

    expect(state.current).toMatchObject({
      invocation: 1,
      nativeStage: "container",
      status: "failed",
      stageElapsedMs: 2_400,
      elapsedMs: 3_200,
    });
    expect(state.events).toHaveLength(2);

    state = beginOnboardingActivityInvocation(state, 4_300);
    state = applyOnboardingProgress(state, progress({
      stage: "container", status: "start", message: "Riprovo l’avvio del container.",
      sequence: 1, elapsedMs: 0,
    }), 4_300);
    state = applyOnboardingProgress(state, progress({
      stage: "container", status: "progress", message: "Verifico il container avviato.",
      sequence: 2, elapsedMs: 2_000,
    }), 6_300);
    state = applyOnboardingProgress(state, progress({
      stage: "container", status: "done", message: "Container verificato.",
      sequence: 3, elapsedMs: 2_600,
    }), 6_900);

    expect(state.current).toMatchObject({
      invocation: 2,
      nativeStage: "container",
      status: "completed",
      stageElapsedMs: 2_600,
      elapsedMs: 5_900,
    });
    expect(state.events.filter((event) => event.nativeStage === "container")).toEqual([
      expect.objectContaining({ invocation: 1, status: "failed" }),
      expect.objectContaining({ invocation: 2, status: "completed" }),
    ]);
    expect(JSON.stringify(state.events)).not.toMatch(/token|password|secret|https?:\/\//i);
  });
});
