import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { locales } from "@/i18n/config";
import type { OnboardingActivityState, OnboardingFlowProps } from "../lib/onboarding";
import { applyOnboardingProgress, beginOnboardingActivityInvocation } from "../lib/onboarding-activity";
import { parseOnboardingNativeProgress } from "../lib/onboarding-runtime";
import { RUNTIME_TEXT } from "../lib/onboarding-runtime.i18n";
import { describeError } from "../lib/error-catalog";
import { OnboardingFlow } from "./OnboardingFlow";

/**
 * A Mac whose JHT Podman machine was created with less memory than the team
 * needs (an earlier installer, or by hand): the setup tells it with a notice,
 * and the notice carries the same recreation as the «sees more folders» error,
 * behind the same confirmation. Nothing is resized or deleted by itself.
 */

const KEY = "ui_notice_podman_machine_memory_low";

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

const WITH_NOTICE = [native(1, "start", "ui_engine_start"), native(2, "notice", KEY), native(3, "done", "ui_engine_done")];
const WITHOUT_NOTICE = [native(1, "start", "ui_engine_start"), native(2, "done", "ui_engine_done")];

function renderSetup(
  activity: OnboardingActivityState,
  runtime: OnboardingFlowProps["runtime"],
  onRecreatePodmanMachine?: () => Promise<void>,
) {
  const props: OnboardingFlowProps = {
    account: { displayName: "Ada" },
    platform: "macos",
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
    ...(onRecreatePodmanMachine ? { onRecreatePodmanMachine } : {}),
    locale: "it",
  };
  return render(<OnboardingFlow {...props} />);
}

const WAITING = { status: "action-required", stage: "provider-login", message: "Accedi." } as const;

afterEach(() => {
  localStorage.removeItem("jht-lang");
});

describe("the notice of a machine with too little memory", () => {
  it("is told in the 7 languages, with the size the team needs", () => {
    for (const locale of locales) {
      expect(RUNTIME_TEXT[locale][KEY], locale).toMatch(/4 Gi/);
    }
    expect(RUNTIME_TEXT.it[KEY]).toContain("Ricrea la macchina");
  });

  it("says the team can wait if it works well, in the 7 languages", () => {
    const wait = {
      it: "puoi aspettare", en: "you can wait", de: "kannst du warten", es: "puedes esperar",
      fr: "tu peux attendre", hu: "várhatsz", pt: "podes esperar",
    } as const;
    for (const locale of locales) expect(RUNTIME_TEXT[locale][KEY], locale).toContain(wait[locale]);
  });

  it("asks for the recreation naming what is lost (secrets, Telegram) and what stays, in the 7 languages", () => {
    for (const locale of locales) {
      const confirm = describeError("podman_machine_recreate_confirm", { locale });
      expect(confirm.text, locale).toContain("jht-secrets");
      expect(confirm.text, locale).toContain("jht-telegram-secrets");
      expect(confirm.text, locale).toContain("Telegram");
      expect(confirm.text, locale).toContain("LinkedIn");
      expect(confirm.action, locale).toContain("Telegram");
      expect(confirm.action, locale).toContain("~/.jht");
    }
  });

  it("offers the recreation under the notice, and asks before doing it", async () => {
    localStorage.setItem("jht-lang", "it");
    const recreate = vi.fn().mockResolvedValue(undefined);
    renderSetup(play(WITH_NOTICE), WAITING, recreate);
    expect(screen.getByRole("note")).toHaveTextContent(RUNTIME_TEXT.it[KEY]);

    fireEvent.click(screen.getByRole("button", { name: /Ricrea la macchina Podman/ }));
    // the first click only asks: what is lost and what stays, the same sentence as the folders error
    expect(recreate).not.toHaveBeenCalled();
    expect(screen.getByText(describeError("podman_machine_recreate_confirm", { locale: "it" }).text)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Annulla" }));
    expect(recreate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Ricrea la macchina Podman/ }));
    fireEvent.click(screen.getAllByRole("button").find((button) => /^Sì, cancella/.test(button.textContent ?? ""))!);
    await waitFor(() => expect(recreate).toHaveBeenCalledTimes(1));
  });

  it("is also offered on the screen the setup ends with", () => {
    localStorage.setItem("jht-lang", "it");
    renderSetup(play(WITH_NOTICE), { status: "ready" }, vi.fn().mockResolvedValue(undefined));
    expect(screen.getByRole("note")).toHaveTextContent(RUNTIME_TEXT.it[KEY]);
    expect(screen.getByRole("button", { name: /Ricrea la macchina Podman/ })).toBeInTheDocument();
  });

  it("does not offer it while a step is running", () => {
    localStorage.setItem("jht-lang", "it");
    renderSetup(play(WITH_NOTICE), { status: "working", stage: "container", message: "Preparo." }, vi.fn());
    expect(screen.getByRole("note")).toHaveTextContent(RUNTIME_TEXT.it[KEY]);
    expect(screen.queryByRole("button", { name: /Ricrea la macchina Podman/ })).not.toBeInTheDocument();
  });

  it("says it without a button where the machine cannot be recreated from here", () => {
    localStorage.setItem("jht-lang", "it");
    renderSetup(play(WITH_NOTICE), WAITING);
    expect(screen.getByRole("note")).toHaveTextContent(RUNTIME_TEXT.it[KEY]);
    expect(screen.queryByRole("button", { name: /Ricrea la macchina Podman/ })).not.toBeInTheDocument();
  });

  it("does not attach the button to another notice", () => {
    localStorage.setItem("jht-lang", "it");
    const other = [native(1, "start", "ui_engine_start"), native(2, "notice", "ui_notice_autostart_inactive")];
    renderSetup(play(other), WAITING, vi.fn());
    expect(screen.getByRole("note")).toHaveTextContent(RUNTIME_TEXT.it.ui_notice_autostart_inactive);
    expect(screen.queryByRole("button", { name: /Ricrea la macchina Podman/ })).not.toBeInTheDocument();
  });

  it("shows nothing, and no button, when the machine is fine", () => {
    localStorage.setItem("jht-lang", "it");
    renderSetup(play(WITHOUT_NOTICE), WAITING, vi.fn());
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ricrea la macchina Podman/ })).not.toBeInTheDocument();
  });
});
