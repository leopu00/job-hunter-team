import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { OnboardingFlowProps } from "../lib/onboarding";
import { describeError } from "../lib/error-catalog";
import { OnboardingFlow } from "./OnboardingFlow";
import { ONBOARDING_TEXT, type OnboardingCopy } from "./onboarding.i18n";
import type { Locale } from "@/i18n/config";

const t = ONBOARDING_TEXT.it;
const described = describeError("local_account_owner_mismatch", { locale: "it" });
const mismatch = {
  status: "failed", stage: "runtime", code: "local_account_owner_mismatch", retryable: false,
  message: described.text, action: described.action,
} as const;

function owner(known = true) {
  return {
    probe: vi.fn().mockResolvedValue(known),
    returnToOwner: vi.fn().mockResolvedValue(undefined),
    takeOver: vi.fn().mockResolvedValue(undefined),
  };
}

function renderFlow(overrides: Partial<OnboardingFlowProps> = {}) {
  const localOwner = owner();
  const props: OnboardingFlowProps = {
    account: { displayName: "Ada", identity: "local" },
    platform: "macos",
    runtime: mismatch,
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
    localOwner,
    locale: "it",
    ...overrides,
  };
  return { ...render(<OnboardingFlow {...props} />), props, localOwner: props.localOwner as ReturnType<typeof owner> };
}

describe("the runtime belongs to another local profile: two ways, each one after a confirmation", () => {
  it("offers both only once the owner is known, and says nothing is moved or deleted", async () => {
    const user = userEvent.setup();
    const { localOwner } = renderFlow();
    expect(await screen.findByTestId("local-owner-take")).toBeInTheDocument();
    expect(screen.getByTestId("local-owner-return")).toBeInTheDocument();
    expect(localOwner.probe).toHaveBeenCalledOnce();
    // Going back is the highlighted way, taking over the quieter one.
    expect(screen.getByTestId("local-owner-return")).toHaveClass("onboarding-primary");
    expect(screen.getByTestId("local-owner-take")).toHaveClass("onboarding-secondary");
    await user.click(screen.getByTestId("local-owner-take"));
    expect(screen.getByText(t.ownerTakeText)).toBeInTheDocument();
    // The sentence names what the take-over makes the current profile's, and what it does not do.
    expect(t.ownerTakeText).toMatch(/abbinamento del dispositivo/);
    expect(t.ownerTakeText).toMatch(/accessi ai provider/);
    expect(t.ownerTakeText).toMatch(/Non si sposta e non si cancella niente/);
    expect(localOwner.takeOver).not.toHaveBeenCalled();
    expect(localOwner.returnToOwner).not.toHaveBeenCalled();
  });

  it("is silent when the owner is unknown, when the probe fails, for an account and on another error", async () => {
    const unknown = owner(false);
    const { unmount } = renderFlow({ localOwner: unknown });
    await waitFor(() => expect(unknown.probe).toHaveBeenCalled());
    expect(screen.queryByTestId("local-owner-take")).toBeNull();
    expect(screen.queryByTestId("local-owner-return")).toBeNull();
    unmount();

    const failing = { ...owner(), probe: vi.fn().mockRejectedValue(new Error("boom")) };
    const second = renderFlow({ localOwner: failing });
    await waitFor(() => expect(failing.probe).toHaveBeenCalled());
    expect(screen.queryByTestId("local-owner-take")).toBeNull();
    second.unmount();

    const account = renderFlow({ account: { displayName: null, identity: "google" } });
    expect(account.localOwner.probe).not.toHaveBeenCalled();
    expect(screen.queryByTestId("local-owner-take")).toBeNull();
    account.unmount();

    const other = renderFlow({ runtime: { ...mismatch, code: "local_account_owner_missing" } });
    expect(other.localOwner.probe).not.toHaveBeenCalled();
    expect(screen.queryByTestId("local-owner-take")).toBeNull();
  });

  it("leaving or cancelling a confirmation runs nothing", async () => {
    const user = userEvent.setup();
    const { localOwner } = renderFlow();
    await user.click(await screen.findByTestId("local-owner-take"));
    await user.click(screen.getByTestId("local-owner-cancel"));
    await user.click(screen.getByTestId("local-owner-return"));
    await user.click(screen.getByTestId("local-owner-cancel"));
    expect(localOwner.takeOver).not.toHaveBeenCalled();
    expect(localOwner.returnToOwner).not.toHaveBeenCalled();
    expect(screen.getByTestId("local-owner-take")).toBeEnabled();
  });

  it("taking over runs once, then the setup starts again; a double click is one call", async () => {
    const user = userEvent.setup();
    let release: () => void = () => {};
    const { props, localOwner } = renderFlow();
    localOwner.takeOver.mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));
    await user.click(await screen.findByTestId("local-owner-take"));
    const confirm = screen.getByTestId("local-owner-confirm");
    await user.dblClick(confirm);
    expect(localOwner.takeOver).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect(props.onRetry).toHaveBeenCalledTimes(1));
    expect(localOwner.returnToOwner).not.toHaveBeenCalled();
  });

  it("going back runs once and does not start the setup by itself: the profile change does", async () => {
    const user = userEvent.setup();
    const { props, localOwner } = renderFlow();
    await user.click(await screen.findByTestId("local-owner-return"));
    expect(screen.getByText(t.ownerReturnText)).toBeInTheDocument();
    await user.dblClick(screen.getByTestId("local-owner-confirm"));
    await waitFor(() => expect(localOwner.returnToOwner).toHaveBeenCalledTimes(1));
    expect(localOwner.takeOver).not.toHaveBeenCalled();
    expect(props.onRetry).not.toHaveBeenCalled();
  });

  it("a refusal is said in the app's words and changes nothing: no retry of the setup", async () => {
    const user = userEvent.setup();
    const { props, localOwner } = renderFlow();
    localOwner.takeOver.mockRejectedValue({ code: "local_owner_change_refused", message: "local_owner_change_refused", retryable: true });
    await user.click(await screen.findByTestId("local-owner-take"));
    await user.click(screen.getByTestId("local-owner-confirm"));
    const result = await screen.findByTestId("local-data-result");
    const refused = describeError("local_owner_change_refused", { locale: "it" });
    expect(refused.known).toBe(true);
    expect(result).toHaveTextContent(refused.text);
    expect(result).not.toHaveTextContent("local_owner_change_refused");
    expect(props.onRetry).not.toHaveBeenCalled();
  });
});

describe("the confirmation texts exist in every language and say the same things", () => {
  const locales = Object.keys(ONBOARDING_TEXT) as Locale[];
  const keys: Array<keyof OnboardingCopy> = [
    "ownerReturn", "ownerReturnAria", "ownerReturnTitle", "ownerReturnText", "ownerReturnYes",
    "ownerTake", "ownerTakeAria", "ownerTakeTitle", "ownerTakeText", "ownerTakeYes",
  ];
  it("has the seven locales with every key filled in", () => {
    expect(locales.sort()).toEqual(["de", "en", "es", "fr", "hu", "it", "pt"]);
    for (const locale of locales) {
      for (const key of keys) {
        expect(typeof ONBOARDING_TEXT[locale][key], `${locale}.${key}`).toBe("string");
        expect((ONBOARDING_TEXT[locale][key] as string).length, `${locale}.${key}`).toBeGreaterThan(8);
      }
    }
  });
  it("never claims anything is moved, copied or deleted by the take-over, and never leaks a code", () => {
    for (const locale of locales) {
      for (const key of keys) expect(ONBOARDING_TEXT[locale][key] as string).not.toMatch(/local_|_mismatch|\.desktop-account-scope/);
    }
  });
});
