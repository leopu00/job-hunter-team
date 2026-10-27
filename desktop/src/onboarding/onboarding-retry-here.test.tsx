import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { locales } from "@/i18n/config";
import type { OnboardingFlowProps } from "../lib/onboarding";
import { OnboardingFlow } from "./OnboardingFlow";
import { ONBOARDING_TEXT } from "./onboarding.i18n";

// A failed step (the team already running, found by the 27/10 collaudo) showed the reason and «Show the log file»
// at the top and the retry button under the step list: in a short window only «To retry» was in view.
const props = (over: Partial<OnboardingFlowProps>): OnboardingFlowProps => ({
  account: { displayName: "Ada", identity: "local" },
  platform: "macos",
  runtime: { status: "failed", stage: "runtime", message: "Il team è acceso.", action: "Fermalo con jht down.", code: "runtime_install_failed", retryable: true },
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
  runtimeLogPath: "/synthetic/runtime.log",
  onOpenRuntimeLog: vi.fn().mockResolvedValue(undefined),
  locale: "it",
  ...over,
});

afterEach(cleanup);

describe("the retry of a failed setup step", () => {
  it("is beside the reason and the log link, and runs the same retry as the button under the steps", async () => {
    const onRetry = vi.fn().mockResolvedValue(undefined);
    render(<OnboardingFlow {...props({ onRetry })} />);
    const alert = screen.getByRole("alert");
    const here = within(alert).getByTestId("onboarding-retry-here");
    expect(here).toHaveTextContent("Riprova la preparazione");
    expect(within(alert).getByRole("button", { name: /mostra il file del registro/i })).toBeInTheDocument();
    await userEvent.click(here);
    await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(1));
  });

  it("is told as the button under the steps is, in every language", () => {
    for (const locale of locales) {
      render(<OnboardingFlow {...props({ locale })} />);
      const label = ONBOARDING_TEXT[locale].retryPrepare;
      expect(within(screen.getByRole("alert")).getByTestId("onboarding-retry-here"), locale).toHaveTextContent(label);
      expect(screen.getAllByRole("button", { name: label }), locale).toHaveLength(2);
      cleanup();
    }
  });

  it("is not offered where trying again cannot help or would be unsafe", () => {
    for (const runtime of [
      { status: "failed", stage: "runtime", message: "Rifai la macchina.", code: "podman_machine_mounts_home", retryable: false },
      { status: "failed", stage: "ssh-host-key", message: "La chiave è cambiata.", code: "host_key_changed", retryable: false },
    ] as const) {
      render(<OnboardingFlow {...props({ runtime })} />);
      expect(screen.queryByTestId("onboarding-retry-here"), runtime.code).toBeNull();
      cleanup();
    }
  });

  it("is not there while the step works or waits for the person", () => {
    render(<OnboardingFlow {...props({ runtime: { status: "working", stage: "runtime", message: "Preparo" } })} />);
    expect(screen.queryByTestId("onboarding-retry-here")).toBeNull();
  });
});
