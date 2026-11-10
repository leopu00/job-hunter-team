import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HarnessChoice, HarnessOutcome } from "../lib/harness-choice";
import type { OnboardingFlowProps } from "../lib/onboarding";
import EngineChoice from "./EngineChoice";
import { OnboardingFlow } from "./OnboardingFlow";

// Before the provider's sign-in, on this computer, the person can choose the program that drives the agents. Pi
// signs in in a terminal, so while Pi is chosen and not signed in the step waits. Synthetic replies only.
const choice = (over: Partial<HarnessChoice> = {}): HarnessOutcome => ({
  ok: true,
  value: { harness: "codex", provider: "openai", piAllowed: true, login: "signed_out", ...over },
});

const mocks = vi.hoisted(() => ({ read: vi.fn(), set: vi.fn() }));
vi.mock("../lib/harness-choice", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/harness-choice")>()),
  readHarnessChoice: mocks.read,
  setHarnessChoice: mocks.set,
}));

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  document.cookie = "NEXT_LOCALE=it; path=/";
  mocks.read.mockReset();
  mocks.set.mockReset();
});
afterEach(cleanup);

describe("EngineChoice", () => {
  it("is not shown where Pi cannot be chosen or the choice cannot be read, and the step is not held", async () => {
    for (const read of [async () => choice({ piAllowed: false }), async () => ({ ok: false, code: "harness_unavailable" }) as HarnessOutcome, async () => Promise.reject(new Error("x"))]) {
      const onBlock = vi.fn();
      const view = render(<EngineChoice onBlock={onBlock} read={read} set={vi.fn()} />);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(screen.queryByTestId("engine-choice")).toBeNull();
      expect(onBlock).not.toHaveBeenCalledWith(true);
      view.unmount();
    }
  });

  it("with Codex in charge holds nothing; choosing Pi writes it and holds the step until Pi is signed in", async () => {
    const onBlock = vi.fn();
    const set = vi.fn(async () => choice({ harness: "pi" }));
    const reads = [choice(), choice({ harness: "pi", login: "signed_in" })];
    render(<EngineChoice onBlock={onBlock} read={async () => reads.shift() ?? choice({ harness: "pi", login: "signed_in" })} set={set} />);
    expect(await screen.findByTestId("engine-choice")).toBeInTheDocument();
    expect(onBlock).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByLabelText(/^Pi/));
    await waitFor(() => expect(set).toHaveBeenCalledWith("pi"));
    expect(await screen.findByTestId("engine-command")).toHaveTextContent("jht oauth-login");
    await waitFor(() => expect(onBlock).toHaveBeenLastCalledWith(true));
    fireEvent.click(screen.getByTestId("engine-recheck"));
    await waitFor(() => expect(screen.queryByTestId("engine-command")).toBeNull());
    expect(onBlock).toHaveBeenLastCalledWith(false);
    expect(screen.getByTestId("engine-login")).toHaveAttribute("data-login", "signed_in");
  });

  it("a write that is not confirmed by the CLI shows its error and changes nothing on the screen", async () => {
    const onBlock = vi.fn();
    render(<EngineChoice onBlock={onBlock} read={async () => choice()} set={async () => ({ ok: false, code: "harness_refused" })} />);
    await screen.findByTestId("engine-choice");
    fireEvent.click(screen.getByLabelText(/^Pi/));
    expect(await screen.findByTestId("engine-error")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Codex/)).toBeChecked();
    expect(onBlock).not.toHaveBeenCalledWith(true);
  });

  it("releases the step when it goes away", async () => {
    const onBlock = vi.fn();
    const view = render(<EngineChoice onBlock={onBlock} read={async () => choice({ harness: "pi" })} set={vi.fn()} />);
    await screen.findByTestId("engine-command");
    expect(onBlock).toHaveBeenLastCalledWith(true);
    view.unmount();
    expect(onBlock).toHaveBeenLastCalledWith(false);
  });
});

function flow(runtime: OnboardingFlowProps["runtime"], overrides: Partial<OnboardingFlowProps> = {}) {
  return (
    <OnboardingFlow
      account={{ displayName: "Ada", identity: "local" }}
      platform="macos"
      runtime={runtime}
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
      {...overrides}
    />
  );
}

describe("the program of the agents in the setup", () => {
  const signIn = { status: "action-required", stage: "provider-login", message: "Accedi" } as const;

  it("is asked at the sign-in step, and the sign-in waits while Pi is chosen and not signed in", async () => {
    mocks.read.mockResolvedValue(choice({ harness: "pi" }));
    render(flow(signIn));
    expect(await screen.findByTestId("engine-choice")).toBeInTheDocument();
    const action = screen.getAllByRole("button").find((button) => button.className.includes("onboarding-primary"))!;
    await waitFor(() => expect(action).toBeDisabled());
  });

  it("lets the sign-in go on with Codex in charge", async () => {
    mocks.read.mockResolvedValue(choice());
    render(flow(signIn));
    await screen.findByTestId("engine-choice");
    const action = screen.getAllByRole("button").find((button) => button.className.includes("onboarding-primary"))!;
    expect(action).toBeEnabled();
  });

  it("is not asked at any other step", async () => {
    mocks.read.mockResolvedValue(choice());
    render(flow({ status: "action-required", stage: "team-start", message: "Pronto" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByTestId("engine-choice")).toBeNull();
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
