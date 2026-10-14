import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ONBOARDING_TEXT } from "./onboarding.i18n";
import ExistingTeamConnectModal from "./ExistingTeamConnectModal";
import { OnboardingFlow } from "./OnboardingFlow";
import type { OnboardingFlowProps } from "../lib/onboarding";
vi.mock("../components/SshKeyPicker", () => ({ default: () => <span>Key picker</span> }));
vi.mock("./FirstSetupAssistance", () => ({ default: () => null }));
function setup(existing = true) {
  const onSubmit = vi.fn(), onConnectExistingTeam = vi.fn();
  const props: OnboardingFlowProps = {
    account: { identity: "local", displayName: "Synthetic" }, platform: "other", locale: "en",
    runtime: { status: "collecting", stage: "host" }, onSubmit,
    ...(existing ? { onConnectExistingTeam } : {}), onRuntimeAction: vi.fn(), providerLogin: null,
    sshHostKey: null, onConfirmHostKey: vi.fn(), onCancelHostKey: vi.fn(),
    onProviderInput: vi.fn(), onProviderClose: vi.fn(), onProviderRestart: vi.fn(),
    onRetry: vi.fn(), onRestart: vi.fn(), onExitFailure: vi.fn(),
  };
  render(<OnboardingFlow {...props} />);
  return { onSubmit, onConnectExistingTeam };
}
describe("existing VPS entry", () => {
  it("opens connection explicitly before provider selection without preparing a team", async () => {
    const user = userEvent.setup(), calls = setup();
    expect(calls.onConnectExistingTeam).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: ONBOARDING_TEXT.en.startSetup }));
    await user.click(screen.getByRole("button", { name: ONBOARDING_TEXT.en.existingTeam.verifyVps }));
    expect(calls.onConnectExistingTeam).toHaveBeenCalledExactlyOnceWith({ kind: "vps", address: "", user: "root", port: 22, keyPath: "" });
    expect(calls.onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: /choose.*provider/i })).not.toBeInTheDocument();
  });
  it("does not offer an unwired existing-team entry", async () => {
    const user = userEvent.setup(); setup(false);
    await user.click(screen.getByRole("button", { name: ONBOARDING_TEXT.en.startSetup }));
    expect(screen.queryByRole("button", { name: ONBOARDING_TEXT.en.existingTeam.verifyVps })).not.toBeInTheDocument();
  });
});

describe("existing team identifier", () => {
  const host = { kind: "vps" as const, address: "vps.example.invalid", user: "synthetic", port: 22, keyPath: "/synthetic/key" };
  function native() { return { probe: vi.fn().mockResolvedValue({ status: "confirmation_required", algorithm: "ssh-ed25519", fingerprint: "synthetic" }), confirm: vi.fn().mockResolvedValue(undefined), connect: vi.fn().mockResolvedValue({}), connectReadOnly: vi.fn(), discover: vi.fn(), register: vi.fn(), candidate: vi.fn() }; }
  it("requires an explicit identifier before probing and sends it unchanged", async () => {
    const user = userEvent.setup(), bridge = native();
    render(<ExistingTeamConnectModal initialHost={host} bridge={bridge} onCancel={vi.fn()} onConnected={vi.fn()} onReadOnlyConnected={vi.fn()} />);
    expect(screen.getByRole("button", { name: /verifica vps/i })).toBeDisabled();
    expect(bridge.probe).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText(/identificativo della squadra esistente/i), "synthetic-team-001");
    await user.click(screen.getByRole("button", { name: /verifica vps/i }));
    await screen.findByText("synthetic");
    await user.click(screen.getByRole("button", { name: /conferma e collega/i }));
    expect(bridge.connect).toHaveBeenCalledWith({ teamId: "synthetic-team-001", host }, expect.any(Function));
  });
  it("keeps the cloud identifier fixed without a manual identifier field", () => {
    render(<ExistingTeamConnectModal teamId="synthetic-cloud-001" initialHost={host} bridge={native()} onCancel={vi.fn()} onConnected={vi.fn()} onReadOnlyConnected={vi.fn()} />);
    expect(screen.queryByLabelText(/identificativo della squadra esistente/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /verifica vps/i })).toBeEnabled();
  });
});
