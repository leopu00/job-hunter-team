import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  clearOnboardingInterruption,
  loadLocalOnboardingGate,
  markOnboardingReady,
  readOnboardingInterruption,
  recordOnboardingInterruption,
  type OnboardingFlowProps,
  type OnboardingInterruption,
  type OnboardingMarkerStore,
} from "../lib/onboarding";
import { OnboardingFlow } from "./OnboardingFlow";
import { ONBOARDING_TEXT } from "./onboarding.i18n";

const memory = (): OnboardingMarkerStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) };
};
const KEPT: OnboardingInterruption = { stage: "runtime", code: "runtime_install_failed", at: 1_700_000_000_000, provider: "codex" };

describe("the memory of a stopped preparation", () => {
  it("is kept, read back, and forgotten", () => {
    const store = memory();
    expect(readOnboardingInterruption("local:a", store)).toBeUndefined();
    recordOnboardingInterruption("local:a", KEPT, store);
    expect(readOnboardingInterruption("local:a", store)).toEqual(KEPT);
    expect(readOnboardingInterruption("local:b", store)).toBeUndefined();
    clearOnboardingInterruption("local:a", store);
    expect(readOnboardingInterruption("local:a", store)).toBeUndefined();
  });

  it("is ignored when what is stored is not a stage, a provider and a time", () => {
    const store = memory();
    for (const bad of [
      "not json", "[]", JSON.stringify({ ...KEPT, stage: "elsewhere" }), JSON.stringify({ ...KEPT, provider: "other" }),
      JSON.stringify({ ...KEPT, at: "yesterday" }), JSON.stringify({ ...KEPT, code: "a b; rm" }),
    ]) {
      store.setItem("jht.desktop.onboarding.interrupted.local:a", bad);
      expect(readOnboardingInterruption("local:a", store), bad).toBeUndefined();
    }
  });

  it("comes with the local gate, and goes when the profile is ready", () => {
    const store = memory();
    recordOnboardingInterruption("local:p1", KEPT, store);
    const gate = loadLocalOnboardingGate("p1", "Ada", store);
    expect(gate).toMatchObject({ phase: "required", interruption: KEPT });

    markOnboardingReady("local:p1", {
      runtimeInstalled: true, containerRunning: true, providerConfigured: true, providerAuthenticated: true,
      assistantRunning: true, captainRunning: true, profileReady: true, assistantWelcomed: true, directChatReady: true,
    }, store);
    expect(readOnboardingInterruption("local:p1", store)).toBeUndefined();
  });
});

const flow = (over: Partial<OnboardingFlowProps> = {}) => (
  <OnboardingFlow
    account={{ displayName: "Ada", identity: "local" }}
    platform="windows"
    runtime={{ status: "collecting", stage: "host" }}
    onSubmit={vi.fn().mockResolvedValue(undefined)}
    onRuntimeAction={vi.fn().mockResolvedValue(undefined)}
    providerLogin={null}
    sshHostKey={null}
    onConfirmHostKey={vi.fn().mockResolvedValue(undefined)}
    onCancelHostKey={vi.fn()}
    onProviderInput={vi.fn().mockResolvedValue(undefined)}
    onProviderClose={vi.fn().mockResolvedValue(undefined)}
    onProviderRestart={vi.fn().mockResolvedValue(undefined)}
    onRetry={vi.fn().mockResolvedValue(undefined)}
    onRestart={vi.fn().mockResolvedValue(undefined)}
    onExitFailure={vi.fn()}
    locale="it"
    {...over}
  />
);

describe("the first step after a stopped preparation", () => {
  it("says it stopped, why, and offers Resume and Start over", async () => {
    const resume = vi.fn().mockResolvedValue(undefined);
    const discard = vi.fn();
    render(flow({ interruption: KEPT, onResumeInterrupted: resume, onDiscardInterruption: discard }));
    const note = screen.getByTestId("onboarding-interrupted");
    expect(within(note).getByText(ONBOARDING_TEXT.it.interruptedTitle)).toBeInTheDocument();
    expect(note).toHaveTextContent(/Si è fermata il .*2023/);
    expect(note).not.toHaveTextContent(/\{date\}|\{reason\}/);
    expect(note).toHaveTextContent("Una parte può essere già installata");

    await userEvent.click(within(note).getByRole("button", { name: /Riprendi la preparazione/ }));
    expect(resume).toHaveBeenCalledOnce();
    await userEvent.click(within(note).getByRole("button", { name: "Ricomincia da capo" }));
    expect(discard).toHaveBeenCalledOnce();
  });

  it("tells the catalog's sentence for a code it knows, and the log for one it does not", () => {
    const { unmount } = render(flow({
      interruption: { ...KEPT, code: "runtime_install_failed" },
      onResumeInterrupted: vi.fn(), onDiscardInterruption: vi.fn(),
    }));
    expect(screen.getByTestId("onboarding-interrupted")).not.toHaveTextContent(ONBOARDING_TEXT.it.interruptedUnknown);
    unmount();
    render(flow({
      interruption: { ...KEPT, code: "a_code_nobody_catalogued" },
      onResumeInterrupted: vi.fn(), onDiscardInterruption: vi.fn(),
    }));
    expect(screen.getByTestId("onboarding-interrupted")).toHaveTextContent(ONBOARDING_TEXT.it.interruptedUnknown);
  });

  it("shows nothing when nothing stopped", () => {
    render(flow());
    expect(screen.queryByTestId("onboarding-interrupted")).toBeNull();
  });

  it.each(Object.keys(ONBOARDING_TEXT) as (keyof typeof ONBOARDING_TEXT)[])("%s: the text has its two slots and two different button labels", (locale) => {
    const text = ONBOARDING_TEXT[locale];
    expect(text.interruptedText).toContain("{date}");
    expect(text.interruptedText).toContain("{reason}");
    expect(text.resumeSetup).not.toBe(text.startOver);
  });
});
