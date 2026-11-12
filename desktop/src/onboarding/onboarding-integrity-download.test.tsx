import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OnboardingFlowProps } from "../lib/onboarding";
import { describeError } from "../lib/error-catalog";
import { OnboardingFlow } from "./OnboardingFlow";
import { ONBOARDING_TEXT } from "./onboarding.i18n";

const openPublicPage = vi.hoisted(() => vi.fn().mockResolvedValue(true));
vi.mock("../lib/public-pages", async (importOriginal) => ({ ...(await importOriginal<typeof import("../lib/public-pages")>()), openPublicPage }));

const t = ONBOARDING_TEXT.it;

function failed(code: string, retryable: boolean) {
  const described = describeError(code, { locale: "it" });
  return { status: "failed", stage: "runtime", code, retryable, message: described.text, action: described.action } as const;
}

function renderFlow(runtime: OnboardingFlowProps["runtime"]) {
  const props: OnboardingFlowProps = {
    account: { displayName: "Ada", identity: "local" },
    platform: "macos",
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
    locale: "it",
  };
  return { ...render(<OnboardingFlow {...props} />), props };
}

describe("an installer that is not the one this build expects: the way out is in the screen", () => {
  beforeEach(() => openPublicPage.mockClear());

  it.each(["installer_digest_mismatch", "installer_digest_missing", "installer_digest_invalid", "installer_payload_invalid"])(
    "%s offers the download of the latest version, and no «correct the data» line",
    async (code) => {
      const user = userEvent.setup();
      renderFlow(failed(code, false));
      // the sentence says «update Job Hunter Team»: the button is what does it
      expect(screen.getByText(/aggiorna Job Hunter Team/)).toBeInTheDocument();
      const download = screen.getByTestId("onboarding-download-latest");
      expect(download).toHaveTextContent(t.downloadLatest);
      expect(screen.queryByText(t.fixData)).toBeNull();
      await user.click(download);
      expect(openPublicPage).toHaveBeenCalledWith("download");
    },
  );

  it("is not offered for other errors, which keep their own line and buttons", () => {
    renderFlow(failed("runtime_change_requires_migration", false));
    expect(screen.queryByTestId("onboarding-download-latest")).toBeNull();
    // a failure that has no action of its own and is not an integrity one still asks for the data to be corrected
    renderFlow({ status: "failed", stage: "runtime", code: "host_config_invalid", retryable: false, message: "Host non valido." });
    expect(screen.getByText(t.fixData)).toBeInTheDocument();
    // the way back to the host choice is there for every failure
    expect(screen.getAllByText(t.backToHost).length).toBeGreaterThan(0);
  });

  it("says the button in every language", () => {
    for (const locale of ["it", "en", "de", "es", "fr", "hu", "pt"] as const) {
      expect(ONBOARDING_TEXT[locale].downloadLatest).toBeTruthy();
    }
  });
});
