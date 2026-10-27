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
  it("runs at the first click after the step failed again while the previous retry was still finishing", async () => {
    // The retry promise outlives the screen: the step went working → failed again, the button is back, and the
    // click on it must not be thrown away because the earlier retry has not returned yet.
    let finishFirst: () => void = () => undefined;
    const onRetry = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => { finishFirst = resolve; }))
      .mockResolvedValue(undefined);
    const failed = { status: "failed", stage: "runtime", message: "Il team è acceso.", code: "local_team_running", retryable: true } as const;
    const { rerender } = render(<OnboardingFlow {...props({ onRetry, runtime: failed })} />);
    await userEvent.click(within(screen.getByRole("alert")).getByTestId("onboarding-retry-here"));
    expect(onRetry).toHaveBeenCalledTimes(1);
    rerender(<OnboardingFlow {...props({ onRetry, runtime: { status: "working", stage: "runtime", message: "Preparo" } })} />);
    rerender(<OnboardingFlow {...props({ onRetry, runtime: { ...failed, code: "runtime_install_failed" } })} />);
    const again = within(screen.getByRole("alert")).getByTestId("onboarding-retry-here");
    expect(again).not.toBeDisabled();
    await userEvent.click(again);
    expect(onRetry).toHaveBeenCalledTimes(2);
    finishFirst();
  });
});

// The team already runs (install.sh refuses to change it under the agents): nothing failed and nothing was changed.
// The card must not look like a fault («Set up again: Runtime», red, «Action required»): it says what to do.
describe("the card of a setup stopped only because the team runs", () => {
  const running = (over: Record<string, unknown> = {}) => ({
    status: "failed", stage: "runtime", title: "Job Hunter Team è già acceso", calm: true,
    message: "Job Hunter Team è già acceso su questo computer.", action: "Fermalo con «jht down» in un terminale e premi di nuovo il pulsante.",
    code: "local_team_running", retryable: true, ...over,
  }) as OnboardingFlowProps["runtime"];
  const card = () => screen.getByRole("heading", { level: 2 }).closest("section") as HTMLElement;

  it("has its own title, the calm tone and the action, and keeps the retry", () => {
    for (const locale of locales) {
      render(<OnboardingFlow {...props({ locale, runtime: running() })} />);
      const text = ONBOARDING_TEXT[locale];
      expect(screen.getByRole("heading", { level: 2 }), locale).toHaveTextContent("Job Hunter Team è già acceso");
      expect(screen.getByRole("heading", { level: 2 }), locale).not.toHaveTextContent(text.configureAgain("Runtime"));
      expect(card().className, locale).not.toContain("onboarding-runtime-card--failed");
      expect(within(card()).getByText(text.yourTurn), locale).toBeInTheDocument();
      expect(within(card()).queryByText(text.interventionRequired), locale).toBeNull();
      expect(within(card()).getByText(/jht down/), locale).toBeInTheDocument();
      expect(within(screen.getByRole("alert")).getByTestId("onboarding-retry-here"), locale).toBeInTheDocument();
      cleanup();
    }
  });

  it("is the only failure told this way: any other keeps the red card and «set up again»", () => {
    render(<OnboardingFlow {...props({ runtime: running({ title: undefined, calm: undefined, code: "runtime_install_failed" }) })} />);
    expect(card().className).toContain("onboarding-runtime-card--failed");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(ONBOARDING_TEXT.it.configureAgain("Runtime"));
    expect(within(card()).getByText(ONBOARDING_TEXT.it.interventionRequired)).toBeInTheDocument();
  });
});
