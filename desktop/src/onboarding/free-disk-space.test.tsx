import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { OnboardingFlowProps } from "../lib/onboarding";
import type { CleanImagesOutcome } from "../lib/clean-images";
import { describeError, ERROR_CATALOG } from "../lib/error-catalog";
import { OnboardingFlow } from "./OnboardingFlow";
import { ONBOARDING_TEXT } from "./onboarding.i18n";

const t = ONBOARDING_TEXT.it;
const diskLow = {
  status: "failed", stage: "team-start", code: "disk_low", retryable: true,
  message: describeError("disk_low").text, action: describeError("disk_low").action,
} as const;
const outcome = (overrides: Partial<CleanImagesOutcome> = {}): CleanImagesOutcome => ({
  removed: 0, freedBytes: 0, refused: 0, inUse: 0, skipped: "", virtualMachine: false, ...overrides,
});

function renderFlow(overrides: Partial<OnboardingFlowProps> = {}) {
  const props: OnboardingFlowProps = {
    account: { displayName: "Ada" },
    platform: "linux",
    runtime: diskLow,
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
    ...overrides,
  };
  return { ...render(<OnboardingFlow {...props} />), props };
}

/** Free up space → confirmation → yes. */
async function freeSpace(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: t.freeSpace }));
  await user.click(screen.getByRole("button", { name: new RegExp(t.freeSpaceYes) }));
}

const resultLine = () => document.querySelector(".onboarding-free-space");

describe("«Free up space» on a full disk", () => {
  it("asks first, then tells the freed space in GB, on the Mac as space of the container engine's virtual machine", async () => {
    const user = userEvent.setup();
    const onFreeDiskSpace = vi.fn().mockResolvedValue(outcome({ removed: 2, freedBytes: 3_435_973_837, inUse: 1, virtualMachine: true }));
    renderFlow({ platform: "macos", onFreeDiskSpace });

    await user.click(screen.getByRole("button", { name: t.freeSpace }));
    expect(onFreeDiskSpace).not.toHaveBeenCalled();
    const confirmation = screen.getByRole("region", { name: t.freeSpaceAria });
    const confirm = describeError("clean_images_confirm_vm", { locale: "it" });
    expect(confirm.known).toBe(true);
    expect(confirmation).toHaveTextContent(confirm.text);
    expect(confirmation).toHaveTextContent(confirm.action);

    await user.click(screen.getByRole("button", { name: new RegExp(t.freeSpaceYes) }));
    expect(onFreeDiskSpace).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(resultLine()).not.toBeNull());
    const expected = describeError("clean_images_freed_vm", { locale: "it", bytes: 3_435_973_837 });
    expect(expected.known).toBe(true);
    expect(resultLine()).toHaveTextContent(`${expected.text} ${expected.action}`);
    expect(resultLine()).toHaveTextContent("fino a circa 3,2 GB nella macchina virtuale del motore dei container");
    expect(expected.action).toContain("disco del Mac");
  });

  it("says the freed space without a virtual machine on Linux", async () => {
    const user = userEvent.setup();
    renderFlow({ onFreeDiskSpace: vi.fn().mockResolvedValue(outcome({ removed: 1, freedBytes: 524_288_000 })) });
    await user.click(screen.getByRole("button", { name: t.freeSpace }));
    expect(screen.getByRole("region", { name: t.freeSpaceAria }))
      .toHaveTextContent(describeError("clean_images_confirm", { locale: "it" }).text);
    await user.click(screen.getByRole("button", { name: new RegExp(t.freeSpaceYes) }));
    await vi.waitFor(() => expect(resultLine()).toHaveTextContent("liberato fino a circa 500 MB."));
    expect(resultLine()).not.toHaveTextContent("macchina virtuale");
  });

  it.each([
    ["nothing to remove", outcome(), "clean_images_nothing"],
    ["kept because in use", outcome({ inUse: 2 }), "clean_images_in_use"],
    ["dates unreadable", outcome({ skipped: "previous-unidentified" }), "clean_images_dates_unreadable"],
    ["engine unreadable", outcome({ skipped: "images-unreadable" }), "clean_images_engine_unreadable"],
  ])("%s: says why nothing was removed", async (_, value, code) => {
    const user = userEvent.setup();
    renderFlow({ onFreeDiskSpace: vi.fn().mockResolvedValue(value) });
    await freeSpace(user);
    const expected = describeError(code, { locale: "it" });
    expect(expected.known).toBe(true);
    await vi.waitFor(() => expect(resultLine()).toHaveTextContent(`${expected.text} ${expected.action}`));
  });

  it("with the engine off says it did not start it", async () => {
    const user = userEvent.setup();
    renderFlow({ onFreeDiskSpace: vi.fn().mockRejectedValue({ code: "clean_images_engine_off" }) });
    await freeSpace(user);
    const expected = describeError("clean_images_engine_off", { locale: "it" });
    await vi.waitFor(() => expect(resultLine()).toHaveTextContent(`${expected.text} ${expected.action}`));
    expect(expected.text).toContain("non l’ho acceso");
  });

  it("on an error shows the cleaning's failure, never the native detail", async () => {
    const user = userEvent.setup();
    renderFlow({ onFreeDiskSpace: vi.fn().mockRejectedValue(new Error("synthetic native detail")) });
    await freeSpace(user);
    const expected = describeError("clean_images_failed", { locale: "it" });
    await vi.waitFor(() => expect(resultLine()).toHaveTextContent(`${expected.text} ${expected.action}`));
    expect(resultLine()).not.toHaveTextContent("synthetic");
  });

  it("speaks the person's language", async () => {
    const user = userEvent.setup();
    renderFlow({ locale: "de", onFreeDiskSpace: vi.fn().mockResolvedValue(outcome({ removed: 1, freedBytes: 2_147_483_648 })) });
    await user.click(screen.getByRole("button", { name: ONBOARDING_TEXT.de.freeSpace }));
    await user.click(screen.getByRole("button", { name: new RegExp(ONBOARDING_TEXT.de.freeSpaceYes) }));
    await vi.waitFor(() => expect(resultLine()).toHaveTextContent("etwa 2 GB freigegeben"));
  });

  it("is offered only on disk_low, with a handler, and not on Windows' own runtime", () => {
    const onFreeDiskSpace = vi.fn();
    const view = renderFlow({ runtime: { ...diskLow, code: "team_start_failed" }, onFreeDiskSpace });
    expect(screen.queryByRole("button", { name: t.freeSpace })).toBeNull();
    view.unmount();
    const withoutHandler = renderFlow();
    expect(screen.queryByRole("button", { name: t.freeSpace })).toBeNull();
    withoutHandler.unmount();
    renderFlow({ platform: "windows", onFreeDiskSpace });
    expect(screen.queryByRole("button", { name: t.freeSpace })).toBeNull();
    expect(ERROR_CATALOG.clean_images_unsupported).toBeDefined();
  });
});
