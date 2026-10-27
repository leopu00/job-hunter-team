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
// The key file is chosen again: its path is never kept, so a draft read back has none.
const VPS = { kind: "vps" as const, address: "vps.example.test", user: "ada", port: 2222, keyPath: "/Users/ada/.ssh/ada_ed25519" };
const VPS_KEPT = { ...VPS, keyPath: "" };
const REACHED: OnboardingDraft = { step: 2, host: VPS, provider: "codex" };
const REACHED_LOCAL: OnboardingDraft = { step: 2, host: { kind: "local" }, provider: "codex" };
const DAY = 24 * 60 * 60 * 1_000;
const KEY = "jht.desktop.onboarding.draft.local:a";
const t = ONBOARDING_TEXT.it;

describe("the memory of the wizard's step", () => {
  it("is kept, read back, and forgotten, for each account apart", () => {
    const store = memory();
    expect(readOnboardingDraft("local:a", store)).toBeUndefined();
    recordOnboardingDraft("local:a", REACHED, store);
    expect(readOnboardingDraft("local:a", store)).toEqual({ ...REACHED, host: VPS_KEPT });
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
    expect(Object.keys(written).sort()).toEqual(["host", "provider", "savedAt", "step"]);
    expect(Object.keys(written.host).sort()).toEqual(["address", "kind", "port", "user"]);
    expect(store.data.get(KEY)).not.toMatch(/hunter2|t-1|passphrase|password|token|keyPath|ssh|\/Users/);
  });

  it("is forgotten after 30 days, and when its date is missing or lies in the future", () => {
    const store = memory();
    recordOnboardingDraft("local:a", REACHED_LOCAL, store);
    const savedAt = JSON.parse(store.data.get(KEY) ?? "{}").savedAt as number;
    expect(readOnboardingDraft("local:a", store, savedAt + 29 * DAY)).toEqual(REACHED_LOCAL);
    expect(readOnboardingDraft("local:a", store, savedAt + 31 * DAY)).toBeUndefined();
    // an expired one is also taken out of the store
    expect(store.data.get(KEY)).toBe("");
    const stored = { step: 1, host: { kind: "local" }, provider: null };
    for (const bad of [stored, { ...stored, savedAt: "yesterday" }, { ...stored, savedAt: savedAt + 2 * DAY }]) {
      store.setItem(KEY, JSON.stringify(bad));
      expect(readOnboardingDraft("local:a", store, savedAt), JSON.stringify(bad)).toBeUndefined();
    }
  });

  it("is ignored when what is stored is not a step, a host and a provider", () => {
    const store = memory();
    const savedAt = Date.now();
    for (const bad of [
      "not json", "[]", "null",
      ...[
        { ...REACHED, step: 4 }, { ...REACHED, step: -1 }, { ...REACHED, step: 1.5 },
        { ...REACHED, provider: "other" },
        { ...REACHED, host: { kind: "cloud" } },
        { ...REACHED, host: { ...VPS, port: 0 } }, { ...REACHED, host: { ...VPS, port: 70000 } },
        { ...REACHED, host: { ...VPS, address: 7 } },
        { ...REACHED, host: { ...VPS, address: "a".repeat(300) } },
      ].map((row) => JSON.stringify({ ...row, savedAt })),
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
    expect(start(REACHED_LOCAL)).toEqual({ step: 2, host: { kind: "local" }, provider: "codex", restored: true });
    expect(start({ step: 0, host: VPS_KEPT, provider: "codex" })).toMatchObject({ step: 0, host: VPS_KEPT, restored: false });
  });

  it("never past what the step needs: an incomplete VPS stops at the environment, a missing provider at the provider", () => {
    expect(start({ step: 3, host: { ...VPS, keyPath: " " }, provider: "codex" })).toMatchObject({ step: 1, restored: true });
    expect(start({ step: 2, host: { ...VPS, address: "" }, provider: "codex" })).toMatchObject({ step: 1 });
    // no provider kept: the proposed one, or the provider step when none is proposed
    expect(start({ step: 3, host: { kind: "local" }, provider: null })).toMatchObject({ step: 3, provider: "codex" });
    expect(wizardStart({ step: 3, host: { kind: "local" }, provider: null }, { host: fresh.host, provider: null }, ["codex"], true, false)).toMatchObject({ step: 2, provider: null });
    // a provider the app no longer offers is the proposed one
    expect(start({ step: 3, host: { kind: "local" }, provider: "claude" })).toMatchObject({ step: 3, provider: "codex" });
    // the key file is chosen again: a VPS read back from the store stops at the environment, where it is asked
    expect(start({ step: 3, host: VPS_KEPT, provider: "codex" })).toMatchObject({ step: 1, host: VPS_KEPT, restored: true });
  });

  it("a computer that cannot run the team falls back to the VPS form, and a stopped preparation keeps the welcome", () => {
    const empty = { kind: "vps" as const, address: "", user: "", port: 22, keyPath: "" };
    const vpsOnly = wizardStart({ step: 3, host: { kind: "local" }, provider: "codex" }, { host: empty, provider: "codex" }, ["codex"], false, false);
    expect(vpsOnly).toMatchObject({ step: 1, host: empty });
    expect(start(REACHED_LOCAL, { interrupted: true })).toMatchObject({ step: 0, restored: false });
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
    render(flow({ draft: REACHED_LOCAL, onDraftChange: vi.fn() }));
    expect(heading(t.providerTitle)).toBeInTheDocument();
    expect(screen.getByTestId("onboarding-draft-note")).toHaveTextContent(t.draftRestored);
    expect(screen.getByText("03 / 04")).toBeInTheDocument();
  });

  it("opens a VPS at the environment with address, user and port back and the key still to choose, and the note is for that step only", async () => {
    const store = memory();
    recordOnboardingDraft("local:a", REACHED, store);
    render(flow({ draft: readOnboardingDraft("local:a", store), onDraftChange: vi.fn() }));
    expect(heading(t.hostTitle)).toBeInTheDocument();
    expect(screen.getByTestId("onboarding-draft-note")).toBeInTheDocument();
    expect(screen.getByDisplayValue("vps.example.test")).toBeInTheDocument();
    expect(screen.getByDisplayValue("ada")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2222")).toBeInTheDocument();
    expect(screen.queryByDisplayValue(/ada_ed25519|\/Users/)).toBeNull();
    expect(screen.getByRole("button", { name: new RegExp(t.continue) })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: t.back }));
    expect(screen.queryByTestId("onboarding-draft-note")).toBeNull();
  });

  it("«Start over» is the welcome again, with the first visit's choices, and forgets the steps", async () => {
    const changed = vi.fn();
    render(flow({ draft: REACHED_LOCAL, onDraftChange: changed }));
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

  it("keeps them when the step changes, not at every key typed", async () => {
    const changed = vi.fn();
    render(flow({ onDraftChange: changed }));
    await userEvent.click(screen.getByRole("button", { name: new RegExp(t.startSetup) }));
    expect(changed).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("radio", { name: new RegExp(t.vpsServer) }));
    await userEvent.type(screen.getByPlaceholderText(t.vpsAddressPlaceholder), "vps.exam");
    expect(changed).toHaveBeenCalledTimes(1);
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
      draft: REACHED_LOCAL, onDraftChange: changed,
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
