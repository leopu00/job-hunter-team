import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OnboardingFlowProps } from "../lib/onboarding";
import { OnboardingFlow } from "./OnboardingFlow";

// A beta tester on a 1366x768 laptop has an app window ~660 px tall. The setup
// pages are 1400-1600 px tall: what the person has to press must be on screen.
const flow = (runtime: OnboardingFlowProps["runtime"], sshHostKey: OnboardingFlowProps["sshHostKey"] = null) => (
  <OnboardingFlow
    account={{ displayName: "Ada", identity: "local" }}
    platform="windows"
    runtime={runtime}
    onSubmit={vi.fn().mockResolvedValue(undefined)}
    onRuntimeAction={vi.fn().mockResolvedValue(undefined)}
    providerLogin={null}
    sshHostKey={sshHostKey}
    onConfirmHostKey={vi.fn().mockResolvedValue(undefined)}
    onCancelHostKey={vi.fn()}
    onProviderInput={vi.fn().mockResolvedValue(undefined)}
    onProviderClose={vi.fn().mockResolvedValue(undefined)}
    onProviderRestart={vi.fn().mockResolvedValue(undefined)}
    onRetry={vi.fn().mockResolvedValue(undefined)}
    onRestart={vi.fn().mockResolvedValue(undefined)}
    onExitFailure={vi.fn()}
    locale="it"
  />
);

const scrollIntoView = vi.fn();
beforeEach(() => {
  scrollIntoView.mockReset();
  Element.prototype.scrollIntoView = scrollIntoView;
});
afterEach(() => {
  delete (Element.prototype as unknown as Record<string, unknown>).scrollIntoView;
});

describe("the step that waits for the person", () => {
  it("brings the fingerprint panel and its button into view", () => {
    render(flow({ status: "action-required", stage: "ssh-host-key", message: "Controlla l’impronta" }, { algorithm: "ssh-ed25519", fingerprint: "SHA256:synthetic" }));
    expect(screen.getByRole("button", { name: /conferma l’impronta/i })).toBeInTheDocument();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "end", behavior: "smooth" });
  });

  it("does the same when the team is ready to start", () => {
    render(flow({ status: "action-required", stage: "team-start", message: "Pronto" }));
    expect(screen.getByRole("button", { name: /avvia la squadra/i })).toBeInTheDocument();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("does not move the page while a step is only working", () => {
    render(flow({ status: "working", stage: "runtime", message: "Preparo" }));
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
