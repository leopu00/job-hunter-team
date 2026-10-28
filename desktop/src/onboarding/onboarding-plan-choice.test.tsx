import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OnboardingFlowProps } from "../lib/onboarding";
import type { PlanChoiceData, PlanOption } from "../lib/provider-plan";
import { OnboardingFlow } from "./OnboardingFlow";

// After the provider's login and before the team starts, the person declares the subscription plan the
// Capitano's first run needs. What Codex reports is only preselected; nothing is written before «Conferma».
const plans: PlanChoiceData = {
  provider: "openai",
  declared: null,
  plans: [
    { id: "plus", label: "Plus", price: "20 $/mese" },
    { id: "pro", label: "Pro", price: "100 $/mese" },
    { id: "pro-max", label: "Pro 20x", price: "200 $/mese" },
  ],
  suggested: null,
};

const teamStart: OnboardingFlowProps["runtime"] = { status: "action-required", stage: "team-start", message: "Pronto" };

function flow(overrides: Partial<OnboardingFlowProps> = {}, runtime = teamStart) {
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

const start = () => screen.getByRole("button", { name: /avvia la squadra/i });
let declare: ReturnType<typeof vi.fn>;
// the mock as the prop it stands for
const declared = () => declare as unknown as (plan: string) => Promise<PlanOption>;
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  declare = vi.fn(async (id: string) => ({ id, label: plans.plans.find((p) => p.id === id)!.label, price: "" }));
});

describe("the subscription plan in the setup", () => {
  it("waits for the person: the team does not start, and nothing is declared, until the plan is confirmed", async () => {
    render(flow({ onLoadPlans: async () => plans, onDeclarePlan: declared() }));
    expect(await screen.findByTestId("plan-choice")).toBeInTheDocument();
    expect(start()).toBeDisabled();
    expect(screen.getByTestId("plan-confirm")).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: /Pro 20x/ }));
    expect(declare).not.toHaveBeenCalled();
    expect(start()).toBeDisabled();
    fireEvent.click(screen.getByTestId("plan-confirm"));
    await waitFor(() => expect(screen.getByTestId("plan-declared")).toHaveTextContent("Piano dichiarato: Pro 20x"));
    expect(declare).toHaveBeenCalledTimes(1);
    expect(declare).toHaveBeenCalledWith("pro-max");
    expect(start()).toBeEnabled();
  });

  it("proposes the plan Codex reports as the one preselected, and writes it only on «Conferma»", async () => {
    render(flow({ onLoadPlans: async () => ({ ...plans, suggested: "pro" }), onDeclarePlan: declared() }));
    await screen.findByTestId("plan-choice");
    expect(screen.getByRole("radio", { name: /Pro 100/ })).toBeChecked();
    expect(screen.getByText("Suggerito da Codex")).toBeInTheDocument();
    expect(declare).not.toHaveBeenCalled();
    expect(start()).toBeDisabled();
    fireEvent.click(screen.getByTestId("plan-confirm"));
    await waitFor(() => expect(declare).toHaveBeenCalledWith("pro"));
  });

  it("declares the plan the person chose even when it is not the one Codex suggested", async () => {
    render(flow({ onLoadPlans: async () => ({ ...plans, suggested: "pro" }), onDeclarePlan: declared() }));
    await screen.findByTestId("plan-choice");
    fireEvent.click(screen.getByRole("radio", { name: /Plus/ }));
    fireEvent.click(screen.getByTestId("plan-confirm"));
    await waitFor(() => expect(declare).toHaveBeenCalledTimes(1));
    expect(declare).toHaveBeenCalledWith("plus");
  });

  it("lets the person leave it to the chat: the team can start and nothing is declared", async () => {
    render(flow({ onLoadPlans: async () => plans, onDeclarePlan: declared() }));
    await screen.findByTestId("plan-choice");
    expect(start()).toBeDisabled();
    fireEvent.click(screen.getByTestId("plan-later-button"));
    expect(screen.getByTestId("plan-later")).toBeInTheDocument();
    expect(start()).toBeEnabled();
    expect(declare).not.toHaveBeenCalled();
  });

  it("asks nothing of a plan that is already declared", async () => {
    render(flow({ onLoadPlans: async () => ({ ...plans, declared: { id: "plus", label: "Plus", price: "" } }), onDeclarePlan: declared() }));
    expect(await screen.findByTestId("plan-declared")).toHaveTextContent("Piano dichiarato: Plus");
    expect(screen.queryByTestId("plan-choice")).toBeNull();
    expect(start()).toBeEnabled();
  });

  it("goes on without the choice when the plans cannot be read", async () => {
    render(flow({ onLoadPlans: async () => { throw { code: "plans_unavailable" }; }, onDeclarePlan: declared() }));
    await waitFor(() => expect(start()).toBeEnabled());
    expect(screen.queryByTestId("plan-choice")).toBeNull();
  });

  it("keeps the team waiting when the plan could not be saved, and the person can try again", async () => {
    declare.mockRejectedValueOnce({ code: "plan_declare_failed" });
    render(flow({ onLoadPlans: async () => plans, onDeclarePlan: declared() }));
    await screen.findByTestId("plan-choice");
    fireEvent.click(screen.getByRole("radio", { name: /Plus/ }));
    fireEvent.click(screen.getByTestId("plan-confirm"));
    expect(await screen.findByTestId("plan-failed")).toBeInTheDocument();
    expect(start()).toBeDisabled();
    fireEvent.click(screen.getByTestId("plan-confirm"));
    await waitFor(() => expect(screen.getByTestId("plan-declared")).toBeInTheDocument());
    expect(declare).toHaveBeenCalledTimes(2);
    expect(start()).toBeEnabled();
  });

  it("is not asked at any other step, nor where the app cannot reach the host", () => {
    const load = vi.fn(async () => plans);
    render(flow({ onLoadPlans: load, onDeclarePlan: declared() }, { status: "working", stage: "team-start", message: "Avvio" }));
    expect(load).not.toHaveBeenCalled();
    expect(screen.queryByTestId("plan-choice")).toBeNull();
  });

  it("does not hold the team back when the app was not given the way to ask", () => {
    render(flow());
    expect(start()).toBeEnabled();
    expect(screen.queryByTestId("plan-loading")).toBeNull();
  });
});
