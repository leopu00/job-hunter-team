import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { OnboardingFlowProps } from "../lib/onboarding";
import { describeError } from "../lib/error-catalog";
import { OnboardingFlow } from "./OnboardingFlow";
import { ONBOARDING_TEXT } from "./onboarding.i18n";

const t = ONBOARDING_TEXT.it;
const described = describeError("local_account_owner_missing", { locale: "it" });
const missing = {
  status: "failed", stage: "runtime", code: "local_account_owner_missing", retryable: false,
  message: described.text, action: described.action,
} as const;
const FOLDER = "jht-data-set-aside-20261026-101500";

function renderFlow(overrides: Partial<OnboardingFlowProps> = {}) {
  const props: OnboardingFlowProps = {
    account: { displayName: "Ada", identity: "local" },
    platform: "macos",
    runtime: missing,
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
    onUseLocalData: vi.fn().mockResolvedValue(undefined),
    onSetAsideLocalData: vi.fn().mockResolvedValue(FOLDER),
    locale: "it",
    ...overrides,
  };
  return { ...render(<OnboardingFlow {...props} />), props };
}

describe("data in ~/.jht that no profile has taken: a choice, never a dead end", () => {
  it("says what happened and names two buttons that exist, without the old advice", () => {
    renderFlow();
    expect(described.known).toBe(true);
    expect(described.text).toContain("dati locali");
    expect(described.action).toContain("Scegli qui sotto");
    expect(described.action).not.toContain("Riparti dalla configurazione tecnica");
    expect(screen.getByText(described.text)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: new RegExp(t.dataUse) })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t.dataAside })).toBeInTheDocument();
  });

  it("leaving without choosing changes nothing: neither command runs, the setup does not start", async () => {
    const user = userEvent.setup();
    const { props } = renderFlow();
    await user.click(screen.getByRole("button", { name: new RegExp(t.dataUse) }));
    await user.click(screen.getByTestId("local-data-cancel"));
    await user.click(screen.getByRole("button", { name: t.dataAside }));
    await user.click(screen.getByTestId("local-data-cancel"));
    expect(props.onUseLocalData).not.toHaveBeenCalled();
    expect(props.onSetAsideLocalData).not.toHaveBeenCalled();
    expect(props.onRetry).not.toHaveBeenCalled();
  });

  it("«Use this data» asks first, with the words that say it makes the data the person's, and only then runs", async () => {
    const user = userEvent.setup();
    const { props } = renderFlow();
    await user.click(screen.getByRole("button", { name: new RegExp(t.dataUse) }));
    expect(props.onUseLocalData).not.toHaveBeenCalled();
    const confirmation = screen.getByRole("region", { name: t.dataUseAria });
    expect(confirmation).toHaveTextContent("Questi dati erano di un altro profilo: usarli li rende tuoi");
    await user.click(screen.getByTestId("local-data-confirm"));
    expect(props.onUseLocalData).toHaveBeenCalledOnce();
    expect(props.onSetAsideLocalData).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(props.onRetry).toHaveBeenCalledOnce());
  });

  it("«Set it aside» asks first, then says where the data went while the setup starts again", async () => {
    const user = userEvent.setup();
    const { props } = renderFlow();
    await user.click(screen.getByRole("button", { name: t.dataAside }));
    expect(props.onSetAsideLocalData).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: t.dataAsideAria })).toHaveTextContent("niente viene cancellato né copiato");
    await user.click(screen.getByTestId("local-data-confirm"));
    expect(props.onSetAsideLocalData).toHaveBeenCalledOnce();
    expect(props.onUseLocalData).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(props.onRetry).toHaveBeenCalledOnce());
    expect(screen.getByTestId("local-data-result")).toHaveTextContent(`«${FOLDER}»`);
    expect(screen.getByTestId("local-data-result")).toHaveTextContent("Non è stato cancellato niente");
  });

  it("when the move fails it says so, nothing starts, and the choice is still there", async () => {
    const user = userEvent.setup();
    const { props } = renderFlow({
      onSetAsideLocalData: vi.fn().mockRejectedValue({ code: "local_data_set_aside_failed" }),
    });
    await user.click(screen.getByRole("button", { name: t.dataAside }));
    await user.click(screen.getByTestId("local-data-confirm"));
    const expected = describeError("local_data_set_aside_failed", { locale: "it" });
    expect(expected.known).toBe(true);
    await vi.waitFor(() => expect(screen.getByTestId("local-data-result")).toHaveTextContent(`${expected.text} ${expected.action}`));
    expect(expected.text).toContain("non è stato toccato niente");
    expect(props.onRetry).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: t.dataAside })).toBeEnabled();
  });

  it("a signed-in account can only set the data aside: «Use this data» is not offered", () => {
    renderFlow({ account: { displayName: "Ada", identity: "google" } });
    expect(screen.queryByRole("button", { name: new RegExp(t.dataUse) })).toBeNull();
    expect(screen.getByRole("button", { name: t.dataAside })).toBeInTheDocument();
  });

  it("no other error offers the choice", () => {
    renderFlow({ runtime: { ...missing, code: "local_account_owner_mismatch" } });
    expect(screen.queryByRole("button", { name: new RegExp(t.dataUse) })).toBeNull();
    expect(screen.queryByRole("button", { name: t.dataAside })).toBeNull();
  });
});
