import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingFlow } from "./OnboardingFlow";
import { ONBOARDING_TEXT } from "./onboarding.i18n";
import { ASSISTANCE_TEXT } from "./assistance.i18n";
import type { OnboardingFlowProps } from "../lib/onboarding";

const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: () => true, Channel: class {} }));
vi.mock("@tauri-apps/api/core", () => native);
// The saved-VPS list is a read of a local file, not what these tests count among the native calls.
vi.mock("../lib/saved-vps", () => ({ savedVpsBridge: { list: async () => [], add: vi.fn(), rename: vi.fn(), remove: vi.fn() } }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: async () => "/synthetic/key" }));
vi.mock("@tauri-apps/api/path", () => ({ homeDir: async () => "/synthetic" }));
const t = ONBOARDING_TEXT.en;

beforeEach(() => { localStorage.clear(); localStorage.setItem("jht-lang", "en"); native.invoke.mockReset(); });
afterEach(() => { cleanup(); localStorage.clear(); });
function wizard(platform: OnboardingFlowProps["platform"]) {
  const props: OnboardingFlowProps = {
    account: { identity: "google", displayName: "Synthetic" }, platform, runtime: { status: "collecting", stage: "host" },
    onSubmit: vi.fn(), onRetry: vi.fn(), onRestart: vi.fn(), onExitFailure: vi.fn(), onRuntimeAction: vi.fn(),
    providerLogin: null, sshHostKey: null, onConfirmHostKey: vi.fn(), onCancelHostKey: vi.fn(),
    onProviderInput: vi.fn(), onProviderClose: vi.fn(), onProviderRestart: vi.fn(),
  };
  render(<OnboardingFlow {...props} />); return props;
}
const vps = () => screen.getByRole("radio", { name: new RegExp(t.vpsServer) });
const next = () => screen.getByRole("button", { name: new RegExp(`^${t.continue}`) });
async function fill(user: ReturnType<typeof userEvent.setup>) {
  fireEvent.change(screen.getByLabelText(t.vpsAddress), { target: { value: "fixture.example.invalid" } });
  fireEvent.change(screen.getByLabelText(t.sshUser), { target: { value: "fixture-user" } });
  fireEvent.change(screen.getByLabelText(t.sshPort), { target: { value: "2222" } });
  await user.click(screen.getByRole("button", { name: t.sshKeyPicker.choose }));
}
function retained() {
  expect(screen.getByLabelText(t.vpsAddress)).toHaveValue("fixture.example.invalid");
  expect(screen.getByLabelText(t.sshUser)).toHaveValue("fixture-user");
  expect(screen.getByLabelText(t.sshPort)).toHaveValue(2222);
  expect(screen.getByText("key", { selector: "strong" })).toBeInTheDocument();
  expect(next()).toBeEnabled();
  expect(screen.getByRole("button", { name: ASSISTANCE_TEXT.en.connect })).toBeEnabled();
}
function noOperation(props: OnboardingFlowProps) {
  expect(native.invoke).not.toHaveBeenCalled();
  expect(props.onSubmit).not.toHaveBeenCalled();
  expect(props.onRuntimeAction).not.toHaveBeenCalled();
}

describe("environment selection is idempotent for the current environment", () => {
  it("retains VPS fields, key, validity, provider and radio focus on repeated clicks", async () => {
    const user = userEvent.setup(); const props = wizard("macos");
    await user.click(screen.getByRole("button", { name: new RegExp(t.startSetup) }));
    await user.click(vps()); await fill(user); retained();
    await user.click(next());
    await user.click(screen.getByRole("radio", { name: /Claude Code/ }));
    await user.click(screen.getByRole("button", { name: t.back }));
    for (let i = 0; i < 2; i++) { await user.click(vps()); retained(); expect(vps()).toHaveFocus(); }
    noOperation(props);
    await user.click(next());
    expect(screen.getByRole("radio", { name: /Claude Code/ })).toHaveAttribute("aria-checked", "true");
  });
  it("retains the same VPS and focus for every arrow key on a VPS-only platform", async () => {
    const user = userEvent.setup(); const props = wizard("other");
    await user.click(screen.getByRole("button", { name: new RegExp(t.startSetup) }));
    expect(screen.getAllByRole("radio")).toHaveLength(1);
    await fill(user); vps().focus();
    for (const key of ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"]) {
      await user.keyboard(`{${key}}`); retained(); expect(vps()).toHaveFocus();
    }
    noOperation(props);
  });
  it("keeps the existing default reset for a real change from VPS to PC and back", async () => {
    const user = userEvent.setup(); const props = wizard("macos");
    await user.click(screen.getByRole("button", { name: new RegExp(t.startSetup) }));
    await user.click(vps()); await fill(user);
    await user.click(screen.getByRole("radio", { name: new RegExp(t.thisComputer) }));
    expect(screen.queryByLabelText(t.vpsAddress)).toBeNull(); expect(next()).toBeEnabled();
    await user.click(vps());
    expect(screen.getByLabelText(t.vpsAddress)).toHaveValue("");
    expect(screen.getByLabelText(t.sshUser)).toHaveValue("");
    expect(screen.getByLabelText(t.sshUser)).toHaveAttribute("placeholder", t.sshUserPlaceholder);
    expect(screen.getByLabelText(t.sshPort)).toHaveValue(22);
    expect(screen.queryByText("key", { selector: "strong" })).toBeNull();
    expect(next()).toBeDisabled();
    expect(screen.getByRole("button", { name: ASSISTANCE_TEXT.en.connect })).toBeDisabled();
    noOperation(props);
  });
});
