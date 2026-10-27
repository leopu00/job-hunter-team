import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  clearOnboardingDraft,
  markOnboardingReady,
  readOnboardingDraft,
  recordOnboardingDraft,
  resetOnboardingMarker,
  type OnboardingDraft,
  type OnboardingFlowProps,
  type OnboardingMarkerStore,
} from "../lib/onboarding";
import { OnboardingFlow } from "./OnboardingFlow";
import { ONBOARDING_TEXT } from "./onboarding.i18n";
import { wizardStart } from "./wizard-draft";

// The wizard's step and choices are kept so that a reopened app does not start from the welcome again.
// Synthetic data only.
const memory = (): OnboardingMarkerStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) };
};
const VPS = { kind: "vps" as const, address: "vps.example.test", user: "ada", port: 2222, keyPath: "/keys/ada_ed25519" };
const REACHED: OnboardingDraft = { step: 2, host: VPS, provider: "codex" };
const KEY = "jht.desktop.onboarding.draft.local:a";
const t = ONBOARDING_TEXT.it;

describe("the memory of the wizard's step", () => {
  it("is kept, read back, and forgotten, for each account apart", () => {
    const store = memory();
    expect(readOnboardingDraft("local:a", store)).toBeUndefined();
    recordOnboardingDraft("local:a", REACHED, store);
    expect(readOnboardingDraft("local:a", store)).toEqual(REACHED);
    expect(readOnboardingDraft("local:b", store)).toBeUndefined();
    recordOnboardingDraft("local:a", { step: 1, host: { kind: "local" }, provider: null }, store);
    expect(readOnboardingDraft("local:a", store)).toEqual({ step: 1, host: { kind: "local" }, provider: null });
    clearOnboardingDraft("local:a", store);
    expect(readOnboardingDraft("local:a", store)).toBeUndefined();
  });

  it("keeps the choices and nothing else: whatever else the object carries is not written", () => {
    const store = memory();
    const carrying = { ...REACHED, host: { ...VPS, password: "hunter2", token: "t-1" }, passphrase: "x" } as unknown as OnboardingDraft;
    recordOnboardingDraft("local:a", carrying, store);
    const written = JSON.parse(store.data.get(KEY) ?? "null");
    expect(Object.keys(written).sort()).toEqual(["host", "provider", "step"]);
    expect(Object.keys(written.host).sort()).toEqual(["address", "keyPath", "kind", "port", "user"]);
    expect(store.data.get(KEY)).not.toMatch(/hunter2|t-1|passphrase|password|token/);
  });

  it("is ignored when what is stored is not a step, a host and a provider", () => {
    const store = memory();
    for (const bad of [
      "not json", "[]", "null",
      JSON.stringify({ ...REACHED, step: 4 }), JSON.stringify({ ...REACHED, step: -1 }), JSON.stringify({ ...REACHED, step: 1.5 }),
      JSON.stringify({ ...REACHED, provider: "other" }),
      JSON.stringify({ ...REACHED, host: { kind: "cloud" } }),
      JSON.stringify({ ...REACHED, host: { ...VPS, port: 0 } }), JSON.stringify({ ...REACHED, host: { ...VPS, port: 70000 } }),
      JSON.stringify({ ...REACHED, host: { ...VPS, address: 7 } }),
      JSON.stringify({ ...REACHED, host: { ...VPS, keyPath: "k".repeat(2_000) } }),
    ]) {
      store.setItem(KEY, bad);
      expect(readOnboardingDraft("local:a", store), bad).toBeUndefined();
    }
  });

  it("goes when the setup is done and when it is started again", () => {
    const store = memory();
    recordOnboardingDraft("local:a", REACHED, store);
    markOnboardingReady("local:a", {
      runtimeInstalled: true, containerRunning: true, providerConfigured: true, providerAuthenticated: true,
      assistantRunning: true, captainRunning: true, profileReady: true, assistantWelcomed: true, directChatReady: true,
    }, store);
    expect(readOnboardingDraft("local:a", store)).toBeUndefined();

    recordOnboardingDraft("local:a", REACHED, store);
    resetOnboardingMarker("local:a", store);
    expect(readOnboardingDraft("local:a", store)).toBeUndefined();
  });
});

describe("where the wizard opens", () => {
  const fresh = { host: { kind: "local" as const }, provider: "codex" as const };
  const start = (draft: OnboardingDraft | undefined, over: { local?: boolean; interrupted?: boolean } = {}) =>
    wizardStart(draft, fresh, ["codex"], over.local ?? true, over.interrupted ?? false);

  it("on the welcome when nothing was kept, on the step reached when something was", () => {
    expect(start(undefined)).toEqual({ step: 0, ...fresh, restored: false });
    expect(start(REACHED)).toEqual({ step: 2, host: VPS, provider: "codex", restored: true });
    expect(start({ step: 0, host: VPS, provider: "codex" })).toMatchObject({ step: 0, host: VPS, restored: false });
  });

  it("never past what the step needs: an incomplete VPS stops at the environment, a missing provider at the provider", () => {
    expect(start({ step: 3, host: { ...VPS, keyPath: " " }, provider: "codex" })).toMatchObject({ step: 1, restored: true });
    expect(start({ step: 2, host: { ...VPS, address: "" }, provider: "codex" })).toMatchObject({ step: 1 });
    // no provider kept: the proposed one, or the provider step when none is proposed
    expect(start({ step: 3, host: VPS, provider: null })).toMatchObject({ step: 3, provider: "codex" });
    expect(wizardStart({ step: 3, host: VPS, provider: null }, { host: fresh.host, provider: null }, ["codex"], true, false)).toMatchObject({ step: 2, provider: null });
    // a provider the app no longer offers is the proposed one
    expect(start({ step: 3, host: VPS, provider: "claude" })).toMatchObject({ step: 3, provider: "codex" });
  });

  it("a computer that cannot run the team falls back to the VPS form, and a stopped preparation keeps the welcome", () => {
    const empty = { kind: "vps" as const, address: "", user: "", port: 22, keyPath: "" };
    const vpsOnly = wizardStart({ step: 3, host: { kind: "local" }, provider: "codex" }, { host: empty, provider: "codex" }, ["codex"], false, false);
    expect(vpsOnly).toMatchObject({ step: 1, host: empty });
    expect(start(REACHED, { interrupted: true })).toMatchObject({ step: 0, host: VPS, restored: false });
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
const heading = (name: string) => screen.getByRole("heading", { name });

describe("the wizard after the app was reopened", () => {
  it("opens on the step it had reached, with the choices made, and says so", () => {
    render(flow({ draft: REACHED, onDraftChange: vi.fn() }));
    expect(heading(t.providerTitle)).toBeInTheDocument();
    expect(screen.getByTestId("onboarding-draft-note")).toHaveTextContent(t.draftRestored);
    expect(screen.getByText("03 / 04")).toBeInTheDocument();
  });

  it("goes back to the choices kept, and the note is for the step it picked up, not for the next ones", async () => {
    render(flow({ draft: REACHED, onDraftChange: vi.fn() }));
    await userEvent.click(screen.getByRole("button", { name: t.back }));
    expect(heading(t.hostTitle)).toBeInTheDocument();
    expect(screen.getByDisplayValue("vps.example.test")).toBeInTheDocument();
    expect(screen.getByDisplayValue("ada")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2222")).toBeInTheDocument();
    expect(screen.queryByTestId("onboarding-draft-note")).toBeNull();
  });

  it("«Start over» is the welcome again, with the first visit's choices, and forgets the steps", async () => {
    const changed = vi.fn();
    render(flow({ draft: REACHED, onDraftChange: changed }));
    await userEvent.click(screen.getByTestId("onboarding-draft-start-over"));
    expect(changed).toHaveBeenLastCalledWith(null);
    expect(screen.getByText("01 / 04")).toBeInTheDocument();
    expect(screen.queryByTestId("onboarding-draft-note")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: new RegExp(t.startSetup) }));
    expect(screen.getByRole("radio", { name: new RegExp(t.thisComputer) })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByDisplayValue("vps.example.test")).toBeNull();
  });

  it("keeps the step and the choices as they change, and writes nothing while the wizard is as a first visit finds it", async () => {
    const changed = vi.fn();
    render(flow({ onDraftChange: changed }));
    expect(changed).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: new RegExp(t.startSetup) }));
    expect(changed).toHaveBeenLastCalledWith({ step: 1, host: { kind: "local" }, provider: "codex" });
    await userEvent.click(screen.getByRole("button", { name: new RegExp(t.continue) }));
    expect(changed).toHaveBeenLastCalledWith({ step: 2, host: { kind: "local" }, provider: "codex" });
    await userEvent.click(screen.getByRole("button", { name: new RegExp(t.reviewSetup) }));
    expect(changed).toHaveBeenLastCalledWith({ step: 3, host: { kind: "local" }, provider: "codex" });
    expect(screen.queryByTestId("onboarding-draft-note")).toBeNull();
  });

  it("does not keep the reopened Provider step, which is not a first setup", async () => {
    const changed = vi.fn();
    render(flow({ onDraftChange: changed, providerOnly: { onCancel: vi.fn() } }));
    await userEvent.click(screen.getByRole("radio", { name: /Codex/ }));
    await userEvent.click(screen.getByRole("button", { name: new RegExp(t.reviewSetup) }));
    expect(changed).not.toHaveBeenCalled();
  });

  it("after a stopped preparation opens on the welcome with its note, the choices kept, and «Start over» drops both", async () => {
    const changed = vi.fn();
    const discard = vi.fn();
    render(flow({
      draft: REACHED, onDraftChange: changed,
      interruption: { stage: "runtime", code: null, at: 1_700_000_000_000, provider: "codex" },
      onResumeInterrupted: vi.fn(), onDiscardInterruption: discard,
    }));
    expect(screen.getByTestId("onboarding-interrupted")).toBeInTheDocument();
    expect(screen.queryByTestId("onboarding-draft-note")).toBeNull();
    expect(screen.getByText("01 / 04")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: t.startOver }));
    expect(discard).toHaveBeenCalledOnce();
    expect(changed).toHaveBeenLastCalledWith(null);
  });

  it.each((Object.keys(ONBOARDING_TEXT) as (keyof typeof ONBOARDING_TEXT)[]).filter((locale) => locale !== "en"))("%s: the note is written in that language, not copied from English", (locale) => {
    expect(ONBOARDING_TEXT[locale].draftRestored.trim().length).toBeGreaterThan(20);
    expect(ONBOARDING_TEXT[locale].draftRestored).not.toBe(ONBOARDING_TEXT.en.draftRestored);
  });
});
