import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { isReadableCause } from "../lib/failure-cause";
import type { OnboardingFlowProps } from "../lib/onboarding";
import { OnboardingFlow } from "./OnboardingFlow";
import { ONBOARDING_TEXT } from "./onboarding.i18n";

const props = (over: Partial<OnboardingFlowProps>): OnboardingFlowProps => ({
  account: { displayName: "Ada", identity: "local" },
  platform: "windows",
  runtime: { status: "collecting", stage: "host" },
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
  ...over,
});

describe("a failed step's cause", () => {
  it("is told when it is a sentence and kept back when it is a piece of a command", () => {
    expect(isReadableCause("winget could not install Podman.CLI (0x8a15000f)")).toBe(true);
    expect(isReadableCause("WSL is not usable")).toBe(true);
    expect(isReadableCause("Podman non è installabile con winget: riprova più tardi")).toBe(true);
    expect(isReadableCause("t '%{http_code}' --proxy http://127.0.0.1:3130 https://example.com/)\" = 403")).toBe(false);
    expect(isReadableCause("curl -s -o /dev/null --proxy http://127.0.0.1:3130 https://example.com")).toBe(false);
    expect(isReadableCause("$(Get-Item $path).Length -gt 0")).toBe(false);
    expect(isReadableCause("x")).toBe(false);
  });

  it("goes to the technical details when the step kept it back", async () => {
    const piece = "t '%{http_code}' --proxy http://127.0.0.1:3130";
    render(<OnboardingFlow {...props({
      runtime: { status: "failed", stage: "runtime", code: "runtime_install_failed", message: "Non riuscita.", cause: piece, retryable: true },
    })} />);
    const details = screen.getByText(ONBOARDING_TEXT.it.technicalDetails).closest("details")!;
    expect(within(details).getByText(ONBOARDING_TEXT.it.technicalCause)).toBeInTheDocument();
    expect(within(details).getByText(piece)).toBeInTheDocument();
    expect(within(details).getByText("runtime_install_failed")).toBeInTheDocument();
  });

  it.each(Object.keys(ONBOARDING_TEXT) as (keyof typeof ONBOARDING_TEXT)[])("%s: has a label for the cause, and the log button says it shows a file", (locale) => {
    expect(ONBOARDING_TEXT[locale].technicalCause.length).toBeGreaterThan(3);
    expect(ONBOARDING_TEXT[locale].openRuntimeLog).not.toBe(ONBOARDING_TEXT[locale].technicalCause);
  });
});
