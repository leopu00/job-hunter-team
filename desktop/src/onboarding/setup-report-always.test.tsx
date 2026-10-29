import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OnboardingFlowProps } from "../lib/onboarding";
import { OnboardingFlow } from "./OnboardingFlow";
import { SUPPORT_REPORT_COPY } from "./SetupSupportReport";

const native = vi.hoisted(() => ({
  isTauri: () => true,
  invoke: vi.fn(async (command: string) => {
    if (command === "onboarding_support_context") return { appVersion: "0.4.0", logTail: "preparing the runtime" };
    return null;
  }),
}));
vi.mock("@tauri-apps/api/core", () => native);

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const props = (runtime: OnboardingFlowProps["runtime"]): OnboardingFlowProps => ({
  account: { displayName: "Ada", identity: "local" },
  platform: "windows",
  runtime,
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
  locale: "en",
});

describe("«Report to support» during the setup", () => {
  it("is there while a step is running, not only after a failure, and says it was not a failure", async () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<OnboardingFlow {...props({ status: "working", stage: "runtime", message: "Preparing" })} />);
    await userEvent.click(screen.getByRole("button", { name: SUPPORT_REPORT_COPY.en.open }));
    const preview = (await screen.findByLabelText(SUPPORT_REPORT_COPY.en.preview)) as HTMLTextAreaElement;
    await waitFor(() => expect(preview.value).toContain("- Step: runtime"));
    expect(preview.value).toContain("- Code: none (the setup had not failed)");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("still carries the failure's code after a failure", async () => {
    render(<OnboardingFlow {...props({ status: "failed", stage: "runtime", code: "runtime_install_failed", message: "Failed.", retryable: true })} />);
    await userEvent.click(screen.getByRole("button", { name: SUPPORT_REPORT_COPY.en.open }));
    const preview = (await screen.findByLabelText(SUPPORT_REPORT_COPY.en.preview)) as HTMLTextAreaElement;
    expect(preview.value).toContain("- Code: runtime_install_failed");
  });

  it("names a failure without a code, as before", async () => {
    render(<OnboardingFlow {...props({ status: "failed", stage: "container", message: "Failed.", retryable: true })} />);
    await userEvent.click(screen.getByRole("button", { name: SUPPORT_REPORT_COPY.en.open }));
    const preview = (await screen.findByLabelText(SUPPORT_REPORT_COPY.en.preview)) as HTMLTextAreaElement;
    expect(preview.value).toContain("- Code: unknown");
  });
});
