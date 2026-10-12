import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FirstSetupAssistance from "./FirstSetupAssistance";
import { OnboardingFlow } from "./OnboardingFlow";
import { ONBOARDING_TEXT } from "./onboarding.i18n";
import { ASSISTANCE_TEXT } from "./assistance.i18n";
import { registerAssistanceHost, type AssistanceHost } from "../lib/closer-desktop-connection";
import type { OnboardingFlowProps } from "../lib/onboarding";

const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: () => true, Channel: class {} }));
vi.mock("@tauri-apps/api/core", () => native);
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: async () => "/synthetic/key" }));
vi.mock("@tauri-apps/api/path", () => ({ homeDir: async () => "/synthetic" }));
const host: AssistanceHost = { kind: "vps", address: "fixture.example.invalid", user: "fixture", port: 22, keyPath: "/synthetic/key" };
const registered = { ok: true, registered: true, assistance_ready: false };
const fingerprint = { status: "confirmation_required", algorithm: "ssh-ed25519", fingerprint: `SHA256:${"a".repeat(43)}` };
beforeEach(() => {
  localStorage.clear(); localStorage.setItem("jht-lang", "en");
  native.invoke.mockReset();
  native.invoke.mockImplementation(async (op: string) => {
    if (op === "closer_desktop_register_host") return registered;
    if (op === "closer_desktop_request") return { ok: false, error: "browser_binding_required" };
    throw new Error("unexpected operation");
  });
});
afterEach(() => { cleanup(); localStorage.clear(); });

describe("official FIRSTSETUP assistance connection", () => {
  it("does not register or poll automatically and denies incomplete/local hosts", () => {
    const view = render(<FirstSetupAssistance host={{ kind: "local" }} locale="en" onOpen={vi.fn()} />);
    expect(screen.getByRole("button", { name: ASSISTANCE_TEXT.en.connect })).toBeDisabled();
    view.rerender(<FirstSetupAssistance host={{ ...host, keyPath: "" }} locale="en" onOpen={vi.fn()} />);
    expect(screen.getByRole("button", { name: ASSISTANCE_TEXT.en.connect })).toBeDisabled();
    view.rerender(<FirstSetupAssistance host={{ ...host, port: 22.5 }} locale="en" onOpen={vi.fn()} />);
    expect(screen.getByRole("button", { name: ASSISTANCE_TEXT.en.connect })).toBeDisabled();
    expect(native.invoke).not.toHaveBeenCalled();
  });
  it("registers only the existing VPS fields on an explicit click, without declaring readiness", async () => {
    const onOpen = vi.fn();
    render(<FirstSetupAssistance host={host} locale="en" onOpen={onOpen} />);
    await userEvent.click(screen.getByRole("button", { name: ASSISTANCE_TEXT.en.connect }));
    expect(native.invoke).toHaveBeenCalledExactlyOnceWith("closer_desktop_register_host", { host });
    expect(onOpen).toHaveBeenCalledOnce();
    expect(Object.keys(localStorage)).toEqual(["jht-lang"]);
  });
  it("requires explicit fingerprint confirmation and returns to registration, never team preparation", async () => {
    let attempts = 0;
    native.invoke.mockImplementation(async (op: string) => {
      if (op === "closer_desktop_register_host") return ++attempts === 1 ? { ok: false, error: "host_key_missing" } : registered;
      if (op === "onboarding_ssh_host_key_probe") return fingerprint;
      if (op === "onboarding_ssh_host_key_confirm") return;
      throw new Error("unexpected operation");
    });
    const onOpen = vi.fn(); render(<FirstSetupAssistance host={host} locale="en" onOpen={onOpen} />);
    await userEvent.click(screen.getByRole("button", { name: ASSISTANCE_TEXT.en.connect }));
    expect(await screen.findByText(fingerprint.fingerprint)).toBeInTheDocument();
    expect(onOpen).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: ONBOARDING_TEXT.en.confirmFingerprint }));
    expect(native.invoke.mock.calls.map(([op]) => op)).toEqual([
      "closer_desktop_register_host", "onboarding_ssh_host_key_probe", "onboarding_ssh_host_key_confirm", "closer_desktop_register_host",
    ]);
    expect(native.invoke).toHaveBeenNthCalledWith(3, "onboarding_ssh_host_key_confirm", { host, algorithm: fingerprint.algorithm, fingerprint: fingerprint.fingerprint });
    expect(onOpen).toHaveBeenCalledOnce();
  });
  it("cancels fingerprint confirmation without writing trust, opening a panel or starting the team", async () => {
    native.invoke.mockImplementation(async (op: string) => op === "closer_desktop_register_host"
      ? { ok: false, error: "host_key_missing" } : fingerprint);
    const onOpen = vi.fn(); render(<FirstSetupAssistance host={host} locale="en" onOpen={onOpen} />);
    await userEvent.click(screen.getByRole("button", { name: ASSISTANCE_TEXT.en.connect }));
    await userEvent.click(await screen.findByRole("button", { name: ONBOARDING_TEXT.en.cancel }));
    expect(screen.queryByText(fingerprint.fingerprint)).toBeNull();
    expect(native.invoke.mock.calls.map(([op]) => op)).toEqual(["closer_desktop_register_host", "onboarding_ssh_host_key_probe"]);
    expect(onOpen).not.toHaveBeenCalled();
  });
  it("discards a registration result if the selected host changes while pending", async () => {
    let done!: (value: unknown) => void;
    native.invoke.mockReturnValue(new Promise((resolve) => { done = resolve; }));
    const onOpen = vi.fn(); const view = render(<FirstSetupAssistance host={host} locale="en" onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: ASSISTANCE_TEXT.en.connect }));
    view.rerender(<FirstSetupAssistance host={{ ...host, address: "changed.example.invalid" }} locale="en" onOpen={onOpen} />);
    await act(async () => { done(registered); });
    expect(onOpen).not.toHaveBeenCalled();
  });
  it.each([{ ok: false, error: "browser_connection_changed" }, { ok: true, registered: true, assistance_ready: true }, null])(
    "does not open the view for denied or malformed registration %j", async (reply) => {
      native.invoke.mockResolvedValue(reply);
      const onOpen = vi.fn(); render(<FirstSetupAssistance host={host} locale="en" onOpen={onOpen} />);
      await userEvent.click(screen.getByRole("button", { name: ASSISTANCE_TEXT.en.connect }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Assistance connection unavailable");
      expect(onOpen).not.toHaveBeenCalled();
    },
  );
  it("never exposes native diagnostics in the registration reply", async () => {
    native.invoke.mockRejectedValue(new Error("synthetic sensitive transport detail"));
    expect(await registerAssistanceHost(host)).toEqual({ ok: false, error: "desktop_transport_unavailable" });
  });
  it("opens the actual unavailable browser before team setup and returns with the wizard choices intact", async () => {
    const props: OnboardingFlowProps = {
      account: { identity: "local", displayName: "Synthetic" }, platform: "macos", runtime: { status: "collecting", stage: "host" },
      onSubmit: vi.fn(), onRetry: vi.fn(), onRestart: vi.fn(), onExitFailure: vi.fn(), onRuntimeAction: vi.fn(),
      providerLogin: null, sshHostKey: null, onConfirmHostKey: vi.fn(), onCancelHostKey: vi.fn(),
      onProviderInput: vi.fn(), onProviderClose: vi.fn(), onProviderRestart: vi.fn(),
    };
    const user = userEvent.setup(); render(<OnboardingFlow {...props} />); const t = ONBOARDING_TEXT.en;
    await user.click(screen.getByRole("button", { name: new RegExp(t.startSetup) }));
    await user.click(screen.getByRole("radio", { name: new RegExp(t.vpsServer) }));
    await user.type(screen.getByLabelText(t.vpsAddress), host.address);
    await user.click(screen.getByRole("button", { name: t.sshKeyPicker.choose }));
    await user.click(screen.getByRole("button", { name: ASSISTANCE_TEXT.en.connect }));
    expect(await screen.findByRole("heading", { name: "Assisted browser" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("browser_binding_required"));
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByRole("button", { name: "Take control" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: ASSISTANCE_TEXT.en.back }));
    expect(screen.getByLabelText(t.vpsAddress)).toHaveValue(host.address);
    expect(screen.getByText("key", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: t.hostTitle })).toHaveFocus();
    expect(props.onSubmit).not.toHaveBeenCalled(); expect(props.onRuntimeAction).not.toHaveBeenCalled();
    expect(props.onConfirmHostKey).not.toHaveBeenCalled();
    expect(native.invoke.mock.calls.map(([op]) => op)).toEqual(["closer_desktop_register_host", "closer_desktop_request"]);
    expect(Object.keys(localStorage)).toEqual(["jht-lang"]);
  });
});
