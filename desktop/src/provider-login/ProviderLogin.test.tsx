import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OnboardingInteractiveEvent } from "../lib/onboarding-runtime";

const native = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("./provider-login-native", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./provider-login-native")>()),
  readProviderLoginState: native.read,
}));
const runtime = vi.hoisted(() => ({
  start: vi.fn(),
  close: vi.fn(),
  input: vi.fn(),
}));
vi.mock("../lib/onboarding-runtime", () => ({
  startOnboardingProviderLogin: runtime.start,
  closeOnboardingProviderLogin: runtime.close,
  sendOnboardingProviderInput: runtime.input,
}));
const chat = vi.hoisted(() => ({ reconnect: vi.fn() }));
vi.mock("../lib/direct-chat", () => ({ reconnectDirectChat: chat.reconnect }));

import { ProviderLoginBanner } from "./ProviderLoginBanner";
import { ProviderLoginCard } from "./ProviderLoginCard";
import { FOCUS_REREAD_MIN_MS, ProviderLoginProvider, REREAD_EVERY_MS } from "./ProviderLoginProvider";

const state = (value: string, provider = "codex", here = true) => ({ ok: true as const, state: value, provider, here });

function Page({ enabled = true }: { enabled?: boolean }) {
  return (
    <ProviderLoginProvider enabled={enabled}>
      <ProviderLoginBanner locale="it" />
      <ProviderLoginCard locale="it" />
    </ProviderLoginProvider>
  );
}

beforeEach(() => {
  document.cookie = "NEXT_LOCALE=it; path=/";
  native.read.mockReset();
  runtime.start.mockReset();
  runtime.close.mockReset().mockResolvedValue(undefined);
  runtime.input.mockReset();
  chat.reconnect.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  document.cookie = "NEXT_LOCALE=; path=/; max-age=0";
  cleanup();
  vi.useRealTimers();
});

describe("the state of the provider sign-in", () => {
  it("shows nothing and asks nothing where the app is not on the team of this computer", () => {
    render(<Page enabled={false} />);
    expect(screen.queryByTestId("provider-login-card")).toBeNull();
    expect(native.read).not.toHaveBeenCalled();
  });

  it("says a working sign-in is active, with no banner", async () => {
    native.read.mockResolvedValue(state("ready"));
    render(<Page />);
    expect(await screen.findByText("L’accesso a ChatGPT (Codex) è attivo.")).toBeTruthy();
    expect(screen.queryByTestId("provider-login-banner")).toBeNull();
  });

  it("a sign-in that is only old is said calmly, offers the sign-in and raises no banner", async () => {
    native.read.mockResolvedValue(state("probably_expired"));
    render(<Page />);
    expect(await screen.findByText(/potrebbe essere scaduto: accedi di nuovo per sicurezza\. La squadra continua a lavorare\./)).toBeTruthy();
    expect(screen.getByTestId("provider-login-signin")).toBeTruthy();
    expect(screen.queryByTestId("provider-login-banner")).toBeNull();
  });

  it("an expired sign-in raises the banner in every page, and the card says it", async () => {
    native.read.mockResolvedValue(state("expired", "claude"));
    render(<Page />);
    const banner = await screen.findByTestId("provider-login-banner");
    expect(banner.textContent).toContain("Gli agenti non riescono a usare il modello.");
    expect(banner.textContent).toContain("Claude");
    expect(screen.getByTestId("provider-login-state").getAttribute("data-state")).toBe("expired");
  });

  it("shows nothing for a team that uses no subscription sign-in", async () => {
    native.read.mockResolvedValue(state("not_applicable", "none"));
    render(<Page />);
    await waitFor(() => expect(native.read).toHaveBeenCalled());
    expect(screen.queryByTestId("provider-login-state")).toBeNull();
    expect(screen.queryByTestId("provider-login-banner")).toBeNull();
  });

  it("a read that fails says its reason (the catalog's sentence), no banner, and the sign-in stays available", async () => {
    native.read.mockResolvedValue({ ok: false, error: "provider_login_unreadable", here: true });
    render(<Page />);
    expect(await screen.findByText(/Non riesco a leggere se l’accesso al provider della squadra funziona\./)).toBeTruthy();
    expect(screen.queryByTestId("provider-login-banner")).toBeNull();
    expect(screen.getByTestId("provider-login-retry")).toBeTruthy();
    expect(screen.getByTestId("provider-login-signin")).toBeTruthy();
  });

  it("with the chat not connected the card offers «Ricollega la chat», which connects it and reads again", async () => {
    native.read.mockResolvedValueOnce({ ok: false, error: "disconnected", here: true }).mockResolvedValue(state("ready"));
    render(<Page />);
    const button = await screen.findByTestId("provider-login-reconnect");
    expect(button.textContent).toBe("Ricollega la chat");
    fireEvent.click(button);
    expect(await screen.findByText("L’accesso a ChatGPT (Codex) è attivo.")).toBeTruthy();
    expect(chat.reconnect).toHaveBeenCalledOnce();
  });

  it("reads again on its own every few minutes", async () => {
    vi.useFakeTimers();
    native.read.mockResolvedValue(state("ready"));
    render(<Page />);
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(native.read).toHaveBeenCalledTimes(1);
    native.read.mockResolvedValue(state("expired"));
    await act(async () => { await vi.advanceTimersByTimeAsync(REREAD_EVERY_MS); });
    expect(native.read).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("provider-login-banner")).toBeTruthy();
  });
});

describe("a team on a server", () => {
  it("shows its state but offers no sign-in from here, and says where it is redone", async () => {
    native.read.mockResolvedValue(state("expired", "codex", false));
    render(<Page />);
    const banner = await screen.findByTestId("provider-login-banner");
    expect(banner.textContent).toContain("La squadra gira su un server");
    expect(screen.queryByTestId("provider-login-banner-signin")).toBeNull();
    expect(screen.queryByTestId("provider-login-signin")).toBeNull();
    expect(screen.getByTestId("provider-login-on-server")).toBeTruthy();
    expect(runtime.start).not.toHaveBeenCalled();
  });

  it("a failed read of a team on a server offers no sign-in either", async () => {
    native.read.mockResolvedValue({ ok: false, error: "disconnected", here: false });
    render(<Page />);
    expect(await screen.findByTestId("provider-login-reconnect")).toBeTruthy();
    expect(screen.queryByTestId("provider-login-signin")).toBeNull();
  });

  it("an answer that does not say where the team runs offers no sign-in", async () => {
    native.read.mockResolvedValue({ ok: false, error: "process_timeout" });
    render(<Page />);
    expect(await screen.findByTestId("provider-login-retry")).toBeTruthy();
    expect(screen.queryByTestId("provider-login-signin")).toBeNull();
  });
});

describe("the window coming back", () => {
  it("reads again only when the last read is at least a minute old: each read takes the chat's channel", async () => {
    vi.useFakeTimers();
    native.read.mockResolvedValue(state("ready"));
    render(<Page />);
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(native.read).toHaveBeenCalledTimes(1);
    await act(async () => { window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(10); });
    expect(native.read).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(FOCUS_REREAD_MIN_MS); });
    await act(async () => { window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(10); });
    expect(native.read).toHaveBeenCalledTimes(2);
  });
});

describe("«Accedi di nuovo»", () => {
  /** A login that shows its address, then ends as the test says. */
  function login(end: { code: number | null }) {
    let finish!: () => void;
    runtime.start.mockImplementation(async (_host: unknown, onEvent: (event: OnboardingInteractiveEvent) => void) => {
      onEvent({ kind: "state", status: "needs_user_action", action: { kind: "url", instruction: "Apri l’indirizzo", safeUrl: "https://auth.openai.com/codex/device" } });
      finish = () => onEvent({ kind: "exit", code: end.code });
      return "session-1";
    });
    return () => finish();
  }

  it("starts only the sign-in, on this computer's team, without any setup", async () => {
    native.read.mockResolvedValue(state("expired"));
    const end = login({ code: 0 });
    render(<Page />);
    fireEvent.click(await screen.findByTestId("provider-login-banner-signin"));
    expect(await screen.findByTestId("provider-login-dialog")).toBeTruthy();
    expect(runtime.start).toHaveBeenCalledOnce();
    expect(runtime.start.mock.calls[0][0]).toEqual({ kind: "local" });
    // the whole dependency of the sign-in on the setup is these three calls: nothing else of the runtime is mocked, so nothing else can run
    native.read.mockResolvedValue(state("ready"));
    await act(async () => { end(); });
    await waitFor(() => expect(screen.queryByTestId("provider-login-dialog")).toBeNull());
    expect(runtime.close).toHaveBeenCalledWith("session-1");
    expect(screen.queryByTestId("provider-login-banner")).toBeNull();
    expect(await screen.findByText("L’accesso a ChatGPT (Codex) è attivo.")).toBeTruthy();
  });

  it("when the sign-in ends the banner goes at once (the team is read again right then), and does not wait for the next read", async () => {
    vi.useFakeTimers();
    native.read.mockResolvedValue(state("expired"));
    const end = login({ code: 0 });
    render(<Page />);
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    fireEvent.click(screen.getByTestId("provider-login-banner-signin"));
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    native.read.mockResolvedValue(state("ready"));
    await act(async () => { end(); await vi.advanceTimersByTimeAsync(10); });
    // far less than the interval between two reads
    expect(screen.queryByTestId("provider-login-banner")).toBeNull();
    expect(screen.queryByTestId("provider-login-dialog")).toBeNull();
    expect(native.read).toHaveBeenCalledTimes(2);
  });

  it("a read that cannot be made right after the sign-in is said in the window, on any page, and the old banner goes", async () => {
    native.read.mockResolvedValue(state("expired"));
    const end = login({ code: 0 });
    // only the banner, as on a page that is not Settings: the window must say it, there is no card to say it
    render(<ProviderLoginProvider enabled><ProviderLoginBanner locale="it" /></ProviderLoginProvider>);
    fireEvent.click(await screen.findByTestId("provider-login-banner-signin"));
    await screen.findByTestId("provider-login-dialog");
    native.read.mockResolvedValue({ ok: false, error: "provider_login_unreadable", here: true });
    await act(async () => { end(); });
    const error = await screen.findByTestId("oauth-login-error");
    expect(error.textContent).toContain("Non riesco a leggere se l’accesso al provider della squadra funziona.");
    expect(screen.getByTestId("provider-login-dialog")).toBeTruthy();
    expect(screen.queryByTestId("provider-login-banner")).toBeNull();
  });

  it("a sign-in that ends but that the team still refuses is told, not called done", async () => {
    native.read.mockResolvedValue(state("expired"));
    const end = login({ code: 0 });
    render(<Page />);
    fireEvent.click(await screen.findByTestId("provider-login-banner-signin"));
    await screen.findByTestId("provider-login-dialog");
    await act(async () => { end(); });
    const error = await screen.findByTestId("oauth-login-error");
    expect(error.textContent).toContain("L’accesso è finito, ma la squadra non lo risulta ancora valido.");
    expect(screen.getByTestId("provider-login-dialog")).toBeTruthy();
  });

  it("a sign-in that fails says so with the catalog's sentence and lets the person try again", async () => {
    native.read.mockResolvedValue(state("expired"));
    const end = login({ code: 1 });
    render(<Page />);
    fireEvent.click(await screen.findByTestId("provider-login-banner-signin"));
    await screen.findByTestId("provider-login-dialog");
    await act(async () => { end(); });
    const error = await screen.findByTestId("oauth-login-error");
    expect(error.textContent).toContain("Il nuovo accesso al provider non è andato a buon fine.");
  });

  it("a start the native side refuses says its own reason", async () => {
    native.read.mockResolvedValue(state("expired"));
    runtime.start.mockRejectedValue({ code: "provider_login_start_failed" });
    render(<Page />);
    fireEvent.click(await screen.findByTestId("provider-login-banner-signin"));
    const error = await screen.findByTestId("oauth-login-error");
    expect(error.textContent).not.toContain("Il nuovo accesso al provider non è andato a buon fine.");
    expect(error.textContent?.length).toBeGreaterThan(10);
  });

  it("cancelling closes the session and the window, and changes nothing else", async () => {
    native.read.mockResolvedValue(state("expired"));
    login({ code: 0 });
    render(<Page />);
    fireEvent.click(await screen.findByTestId("provider-login-banner-signin"));
    await screen.findByTestId("provider-login-dialog");
    await waitFor(() => expect(screen.getByRole("button", { name: /Annulla|Cancel/i })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Annulla|Cancel/i }));
    await waitFor(() => expect(screen.queryByTestId("provider-login-dialog")).toBeNull());
    expect(runtime.close).toHaveBeenCalledWith("session-1");
    expect(screen.getByTestId("provider-login-banner")).toBeTruthy();
  });

  it("is available even when the state cannot be read (the sign-in does not need the chat)", async () => {
    native.read.mockResolvedValue({ ok: false, error: "disconnected", here: true });
    login({ code: 0 });
    render(<Page />);
    fireEvent.click(await screen.findByTestId("provider-login-signin"));
    expect(await screen.findByTestId("provider-login-dialog")).toBeTruthy();
    expect(runtime.start).toHaveBeenCalledOnce();
  });
});
