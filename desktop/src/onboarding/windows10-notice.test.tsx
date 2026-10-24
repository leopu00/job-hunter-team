import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { locales } from "@/i18n/config";
import type { OnboardingActivityState, OnboardingFlowProps } from "../lib/onboarding";
import { applyOnboardingProgress, beginOnboardingActivityInvocation } from "../lib/onboarding-activity";
import { parseOnboardingNativeProgress } from "../lib/onboarding-runtime";
import { RUNTIME_TEXT } from "../lib/onboarding-runtime.i18n";
import { OnboardingFlow } from "./OnboardingFlow";

/**
 * Windows 10: install.ps1 prints `JHT_NOTICE windows10_unsupported`, the Rust
 * sends it as a `notice` of the running step, and the setup screen keeps the
 * sentence for the whole setup, also after the next phase and on a failure.
 * The setup is not stopped by it.
 */

const KEY = "ui_notice_windows10_unsupported";

// What the Rust sends on the channel (serde camelCase), one event at a time.
function native(sequence: number, status: string, message: string, extra: Record<string, unknown> = {}) {
  return { stage: "engine", status, message, sequence, elapsedMs: sequence * 1000, code: null, retryable: null, ...extra };
}

function play(events: unknown[]): OnboardingActivityState {
  let state: OnboardingActivityState | null = beginOnboardingActivityInvocation(null, 0);
  for (const event of events) {
    const progress = parseOnboardingNativeProgress(event);
    expect(progress, JSON.stringify(event)).not.toBeNull();
    state = applyOnboardingProgress(state, progress!, 0);
  }
  return state!;
}

function renderSetup(activity: OnboardingActivityState, runtime: OnboardingFlowProps["runtime"]) {
  const props: OnboardingFlowProps = {
    account: { displayName: "Ada" },
    platform: "windows",
    runtime,
    activity,
    onSubmit: vi.fn().mockResolvedValue(undefined),
    onRuntimeAction: vi.fn().mockResolvedValue(undefined),
    providerLogin: null,
    sshHostKey: null,
    onConfirmHostKey: vi.fn().mockResolvedValue(undefined),
    onCancelHostKey: vi.fn(),
    onProviderInput: vi.fn().mockResolvedValue(undefined),
    onProviderClose: vi.fn().mockResolvedValue(undefined),
    onProviderRestart: vi.fn().mockResolvedValue(undefined),
    onRetry: vi.fn().mockResolvedValue(undefined),
    onRestart: vi.fn().mockResolvedValue(undefined),
    onExitFailure: vi.fn(),
    locale: "it",
  };
  return render(<OnboardingFlow {...props} />);
}

afterEach(() => {
  localStorage.removeItem("jht-lang");
});

describe("the Windows 10 notice reaches the setup screen", () => {
  it("is told in the 7 languages, with «may work» and never «Microsoft»", () => {
    for (const locale of locales) {
      const text = RUNTIME_TEXT[locale][KEY];
      expect(text, locale).toMatch(/Podman/);
      expect(text, locale).toMatch(/Windows 10/);
      expect(text, locale).toMatch(/Windows 11/);
      expect(text, locale).not.toMatch(/Microsoft/i);
    }
    expect(RUNTIME_TEXT.it[KEY]).toBe(
      "Podman non supporta più Windows 10: può funzionare, ma non lo garantiamo. Il sistema supportato è Windows 11.",
    );
  });

  it("stays on screen after the next phase, while the step goes on", () => {
    localStorage.setItem("jht-lang", "it");
    const activity = play([
      native(1, "start", "ui_engine_start"),
      native(2, "progress", "ui_phase_wsl_check"),
      native(3, "notice", KEY),
      native(4, "progress", "ui_phase_wsl_check"),
      native(5, "progress", "ui_phase_podman_install"),
    ]);
    // the step is still the running one, with its latest phase
    expect(activity.current?.status).toBe("active");
    expect(activity.current?.description).toBe(RUNTIME_TEXT.it.ui_phase_podman_install);
    expect(activity.events).toHaveLength(1);
    expect(activity.notices).toEqual([RUNTIME_TEXT.it[KEY]]);

    renderSetup(activity, { status: "working", stage: "runtime", message: "Preparo il runtime." });
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent(RUNTIME_TEXT.it[KEY]);
    // the setup is not shown as failed
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("is kept once, and also on the failure screen", () => {
    localStorage.setItem("jht-lang", "en");
    const activity = play([
      native(1, "start", "ui_engine_start"),
      native(2, "notice", KEY),
      native(3, "notice", KEY),
      native(4, "error", "Podman setup failed", { code: "runtime_install_failed", retryable: true }),
    ]);
    expect(activity.notices).toEqual([RUNTIME_TEXT.en[KEY]]);
    renderSetup(activity, {
      status: "failed", stage: "runtime", code: "runtime_install_failed", retryable: true, message: "Setup failed.",
    });
    expect(screen.getByRole("note")).toHaveTextContent(RUNTIME_TEXT.en[KEY]);
  });

  it("shows nothing when the installer said nothing (Windows 11, Windows Server)", () => {
    localStorage.setItem("jht-lang", "it");
    const activity = play([
      native(1, "start", "ui_engine_start"),
      native(2, "progress", "ui_phase_wsl_check"),
    ]);
    expect(activity.notices ?? []).toEqual([]);
    renderSetup(activity, { status: "working", stage: "runtime", message: "Preparo il runtime." });
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("refuses a notice that carries a failure code", () => {
    expect(parseOnboardingNativeProgress(native(1, "notice", KEY, { code: "x", retryable: true }))).toBeNull();
  });
});

/**
 * The autostart that did not hold (a standard user cannot register the logon task) is told by
 * the same notice, sent at the end of the engine step. The setup goes on to the provider login
 * and to the ready screen within seconds: the sentence must still be there, not only on the
 * screens of a running step.
 */
describe("the autostart notice outlives the engine step", () => {
  const AUTOSTART = "ui_notice_autostart_inactive";
  const played = () => play([
    native(1, "start", "ui_engine_start"),
    native(2, "notice", AUTOSTART),
    native(3, "done", "ui_engine_done"),
  ]);

  it("is on the provider login screen", () => {
    localStorage.setItem("jht-lang", "it");
    const activity = played();
    expect(activity.notices).toEqual([RUNTIME_TEXT.it[AUTOSTART]]);
    const props: OnboardingFlowProps = {
      account: { displayName: "Ada" },
      platform: "windows",
      runtime: { status: "action-required", stage: "provider-login", message: "Accedi." },
      activity,
      onSubmit: vi.fn().mockResolvedValue(undefined),
      onRuntimeAction: vi.fn().mockResolvedValue(undefined),
      providerLogin: { provider: "claude", status: "needs_user_action", actions: [], connectionState: "connected", startedAt: 0 },
      sshHostKey: null,
      onConfirmHostKey: vi.fn().mockResolvedValue(undefined),
      onCancelHostKey: vi.fn(),
      onProviderInput: vi.fn().mockResolvedValue(undefined),
      onProviderClose: vi.fn().mockResolvedValue(undefined),
      onProviderRestart: vi.fn().mockResolvedValue(undefined),
      onRetry: vi.fn().mockResolvedValue(undefined),
      onRestart: vi.fn().mockResolvedValue(undefined),
      onExitFailure: vi.fn(),
      locale: "it",
    };
    render(<OnboardingFlow {...props} />);
    expect(screen.getByRole("note")).toHaveTextContent(RUNTIME_TEXT.it[AUTOSTART]);
  });

  it("is on the ready screen", () => {
    localStorage.setItem("jht-lang", "it");
    renderSetup(played(), { status: "ready" });
    expect(screen.getByRole("note")).toHaveTextContent(RUNTIME_TEXT.it[AUTOSTART]);
  });

  it("is not there when nothing was said", () => {
    localStorage.setItem("jht-lang", "it");
    renderSetup(play([native(1, "start", "ui_engine_start"), native(2, "done", "ui_engine_done")]), { status: "ready" });
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });
});
