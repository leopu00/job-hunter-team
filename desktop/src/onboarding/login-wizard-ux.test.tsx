import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginScreen } from "../components/login-screen";
import { OnboardingFlow } from "./OnboardingFlow";
import { ONBOARDING_TEXT } from "./onboarding.i18n";
import { describeError } from "../lib/error-catalog";
import { LOGIN_ERROR_CATALOG_CODE } from "../lib/login-error-codes";
import type { Locale } from "@/i18n/config";
import type { OnboardingFlowProps } from "../lib/onboarding";

const noBrowsers = async () => [];
const noLocal = () => null;
const account = { identity: "local" as const, displayName: "Synthetic" };
const collecting = { status: "collecting" as const, stage: "host" as const };
function flowProps(): OnboardingFlowProps {
  return { account, platform: "macos", runtime: collecting,
    onSubmit: vi.fn().mockResolvedValue(undefined), onRetry: vi.fn().mockResolvedValue(undefined),
    onRestart: vi.fn().mockResolvedValue(undefined), onExitFailure: vi.fn(),
    onRuntimeAction: vi.fn().mockResolvedValue(undefined), providerLogin: null, sshHostKey: null,
    onConfirmHostKey: vi.fn().mockResolvedValue(undefined), onCancelHostKey: vi.fn(),
    onProviderInput: vi.fn().mockResolvedValue(undefined), onProviderClose: vi.fn().mockResolvedValue(undefined),
    onProviderRestart: vi.fn().mockResolvedValue(undefined) };
}
function Transition() {
  const [ready, setReady] = useState(false);
  return ready ? <OnboardingFlow {...flowProps()} />
    : <LoginScreen configured loadBrowsers={noBrowsers} readLocal={noLocal}
      createLocal={async () => ({ profileId: "synthetic-local", displayName: "Synthetic" })}
      onLocalReady={() => setReady(true)} />;
}

const originalLanguages = Object.getOwnPropertyDescriptor(navigator, "languages");
function system(language: string) {
  Object.defineProperty(navigator, "languages", { configurable: true, get: () => [language] });
}
beforeEach(() => {
  localStorage.clear(); document.cookie = "NEXT_LOCALE=; max-age=0";
});
afterEach(async () => {
  await act(async () => {});
  cleanup(); vi.restoreAllMocks(); localStorage.clear(); document.cookie = "NEXT_LOCALE=; max-age=0";
  if (originalLanguages) Object.defineProperty(navigator, "languages", originalLanguages);
  document.documentElement.scrollTop = 0;
});

const entries: Array<[Locale, string, string, string]> = [
  ["it", "Usa in locale", "Nome visualizzato", "Continua in locale"],
  ["en", "Use locally", "Display name", "Continue locally"],
  ["de", "Lokal verwenden", "Anzeigename", "Lokal fortfahren"],
  ["fr", "Utiliser en local", "Nom affiché", "Continuer en local"],
  ["es", "Usar en local", "Nombre visible", "Continuar en local"],
  ["pt", "Usar localmente", "Nome apresentado", "Continuar localmente"],
  ["hu", "Helyi használat", "Megjelenített név", "Folytatás helyben"],
];

describe("login and wizard locale policy", () => {
  it.each(entries)("keeps system %s across a local login and wizard without setting a preference", async (locale, local, name, next) => {
    system(`${locale}-${locale.toUpperCase()}`);
    const user = userEvent.setup(); render(<Transition />);
    await user.click(screen.getByRole("button", { name: local }));
    await user.type(screen.getByRole("textbox", { name }), "Synthetic");
    await user.click(screen.getByRole("button", { name: next }));
    expect(screen.getByRole("heading", { name: ONBOARDING_TEXT[locale].hello("Synthetic") })).toBeInTheDocument();
    expect(localStorage.getItem("jht-lang")).toBeNull();
    expect(document.cookie).not.toContain("NEXT_LOCALE=");
  });
  it.each(["cookie", "legacy"] as const)("honors the existing %s language over system English", (origin) => {
    system("en-US");
    if (origin === "cookie") {
      localStorage.setItem("jht-lang", "de"); document.cookie = "NEXT_LOCALE=fr";
    } else localStorage.setItem("jht-lang", "fr");
    render(<Transition />);
    expect(screen.getByRole("button", { name: "Utiliser en local" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Usa in locale" })).toBeNull();
  });
  it("uses English rather than forced Italian for an unsupported system language", () => {
    system("ja-JP"); render(<Transition />);
    expect(screen.getByRole("button", { name: "Use locally" })).toBeInTheDocument();
  });
  it("uses the same locale for login error text and login actions", () => {
    system("en-US");
    render(<LoginScreen configured={false} loadBrowsers={noBrowsers} readLocal={noLocal} />);
    expect(screen.getByRole("alert")).toHaveTextContent(describeError(LOGIN_ERROR_CATALOG_CODE["not-configured"], { locale: "en" }).text);
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeDisabled();
  });
});

describe("wizard step scroll and focus", () => {
  function wizard() {
    system("en-US");
    return render(<div data-testid="scroll-owner"><OnboardingFlow {...flowProps()} /></div>);
  }
  function scrollDown() {
    screen.getByRole("main").scrollTop = 500;
    screen.getByTestId("scroll-owner").scrollTop = 700;
    document.documentElement.scrollTop = 900;
  }
  function expectTop() {
    expect(screen.getByRole("main").scrollTop).toBe(0);
    expect(screen.getByTestId("scroll-owner").scrollTop).toBe(0);
    expect(document.documentElement.scrollTop).toBe(0);
  }
  it("starts each forward/back/edit step at the top while retaining choices", async () => {
    const user = userEvent.setup(); wizard(); const t = ONBOARDING_TEXT.en;
    scrollDown(); await user.click(screen.getByRole("button", { name: new RegExp(t.startSetup) })); expectTop();
    expect(screen.getByRole("heading", { name: t.hostTitle })).toHaveFocus();
    scrollDown(); await user.click(screen.getByRole("button", { name: new RegExp(`^${t.continue}`) })); expectTop();
    expect(screen.getByRole("heading", { name: t.providerTitle })).toHaveFocus();
    await user.click(screen.getByRole("radio", { name: /Claude Code/ }));
    scrollDown(); await user.click(screen.getByRole("button", { name: new RegExp(t.reviewSetup) })); expectTop();
    scrollDown(); await user.click(screen.getByRole("button", { name: t.edit })); expectTop();
    expect(screen.getByRole("heading", { name: t.providerTitle })).toHaveFocus();
    expect(screen.getByRole("radio", { name: /Claude Code/ })).toHaveAttribute("aria-checked", "true");
    scrollDown(); await user.click(screen.getByRole("button", { name: t.back })); expectTop();
  });
  it("does not reset scrolling or steal input focus on same-step state changes", async () => {
    const user = userEvent.setup(); wizard(); const t = ONBOARDING_TEXT.en;
    await user.click(screen.getByRole("button", { name: new RegExp(t.startSetup) }));
    await user.click(screen.getByRole("radio", { name: new RegExp(t.vpsServer) }));
    const input = screen.getByLabelText(t.vpsAddress);
    input.focus(); scrollDown(); fireEvent.change(input, { target: { value: "fixture.example.invalid" } });
    expect(input).toHaveFocus(); expect(screen.getByRole("main").scrollTop).toBe(500);
    expect(screen.getByTestId("scroll-owner").scrollTop).toBe(700);
  });
});
