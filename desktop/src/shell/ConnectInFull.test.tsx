import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appLocale } from "../lib/app-locale";
import { existingTeamBridge } from "../lib/existing-team";
import { enterExistingTeamReadOnly, leaveExistingTeamReadOnly } from "../lib/existing-team-readonly";
import { EXISTING_TEAM_READONLY_TEXT } from "../lib/existing-team-readonly.i18n";
import { ReconfirmExistingTeamContext, type ReconfirmExistingTeam } from "../lib/reconfirm-existing-team";
import { ONBOARDING_TEXT } from "../onboarding/onboarding.i18n";
import { installApiBridge, notInDesktop, shellApi } from "./api-bridge";
import { navigate } from "./router";
import Shell from "./Shell";

vi.mock("../lib/supabase", () => ({ supabase: { from: vi.fn() }, supabaseConfigured: true, signOut: vi.fn() }));
vi.mock("../pages/map", () => ({ default: () => <h1>Mappa</h1> }));
vi.mock("../pages/office", () => ({ default: () => <h1>Ufficio</h1> }));
vi.mock("../pages/dashboard", () => ({ default: () => <h1>Dashboard</h1> }));

// The read-only banner's «Collega in scrittura»: the chat's «Collega il team» → «Conferma e collega»,
// opened from the banner. Synthetic data only.
const HOST = { kind: "vps" as const, address: "203.0.113.7", user: "jht", port: 2222, keyPath: "/synthetic/key" };
const SUMMARY = { teamId: "team-opaque-0009", host: HOST, fingerprint: "SHA256:synthetic-pinned" };
const RESULT = {
  runtimeInstalled: true, containerRunning: true, providerConfigured: true, providerAuthenticated: true,
  assistantRunning: true, captainRunning: true, profileReady: true, assistantWelcomed: false, directChatReady: false,
};

let restore: () => void;
function context(): ReconfirmExistingTeam {
  return { accountLabel: "Reader Person", onConnected: vi.fn(async () => undefined), onSetup: vi.fn() };
}
function mount(reconfirm: ReconfirmExistingTeam | null) {
  navigate("/dashboard", { replace: true });
  return render(
    <ReconfirmExistingTeamContext.Provider value={reconfirm}>
      <Shell />
    </ReconfirmExistingTeamContext.Provider>,
  );
}

beforeEach(() => {
  restore = installApiBridge(shellApi(notInDesktop));
  vi.spyOn(existingTeamBridge, "reconfirmSummary").mockResolvedValue(SUMMARY);
  vi.spyOn(existingTeamBridge, "connect").mockResolvedValue(RESULT);
});
afterEach(() => {
  cleanup();
  restore();
  leaveExistingTeamReadOnly();
  vi.restoreAllMocks();
});

describe("«Collega in scrittura» in the read-only banner", () => {
  it("is in the banner of the read-only view, named in the app's language", async () => {
    act(() => enterExistingTeamReadOnly(true, null, "account:a|k1"));
    mount(context());
    const button = await screen.findByTestId("existing-team-connect-in-full");
    expect(button).toHaveTextContent(EXISTING_TEAM_READONLY_TEXT[appLocale()].connectInFull);
    expect(screen.getByTestId("existing-team-readonly-banner").parentElement).toContainElement(button);
    // nothing is asked of the native side until the click
    expect(existingTeamBridge.reconfirmSummary).not.toHaveBeenCalled();
  });

  it("opens the chat's confirmation, with what the setup shows, only on the click", async () => {
    act(() => enterExistingTeamReadOnly(true, null, "account:a|k1"));
    mount(context());
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(await screen.findByTestId("existing-team-connect-in-full"));
    const dialog = await screen.findByRole("dialog");
    expect(await screen.findByText("team-opaque-0009")).toBeTruthy();
    expect(dialog.textContent).toContain("203.0.113.7:2222");
    expect(dialog.textContent).toContain("SHA256:synthetic-pinned");
    expect(dialog.textContent).toContain("Reader Person");
    expect(existingTeamBridge.connect).not.toHaveBeenCalled();
  });

  it("«Conferma e collega» asks the native side for the full connection of the saved host and team", async () => {
    const reconfirm = context();
    act(() => enterExistingTeamReadOnly(true, null, "account:a|k1"));
    mount(reconfirm);
    await userEvent.click(await screen.findByTestId("existing-team-connect-in-full"));
    await userEvent.click(await screen.findByRole("button", { name: ONBOARDING_TEXT[appLocale()].existingTeam.confirmAndLink }));
    await waitFor(() => expect(reconfirm.onConnected).toHaveBeenCalledWith(RESULT));
    expect(vi.mocked(existingTeamBridge.connect).mock.calls[0][0]).toEqual({ teamId: "team-opaque-0009", host: HOST, reconfirm: true });
  });

  it("goes back to the setup when what was saved no longer matches", async () => {
    vi.mocked(existingTeamBridge.reconfirmSummary).mockRejectedValue({ code: "existing_team_reconfirm_setup" });
    const reconfirm = context();
    act(() => enterExistingTeamReadOnly(true, null, "account:a|k1"));
    mount(reconfirm);
    await userEvent.click(await screen.findByTestId("existing-team-connect-in-full"));
    await waitFor(() => expect(reconfirm.onSetup).toHaveBeenCalledOnce());
  });

  it("is not there without the dashboard's confirmation, nor once the team is connected in full", async () => {
    act(() => enterExistingTeamReadOnly(true, null, "account:a|k1"));
    const first = mount(null);
    expect(await screen.findByTestId("existing-team-readonly-banner")).toBeInTheDocument();
    expect(screen.queryByTestId("existing-team-connect-in-full")).toBeNull();
    first.unmount();

    leaveExistingTeamReadOnly();
    act(() => enterExistingTeamReadOnly(true, null, "account:a|full", true));
    mount(context());
    await screen.findByRole("heading", { name: "Dashboard" });
    expect(screen.queryByTestId("existing-team-readonly-banner")).toBeNull();
    expect(screen.queryByTestId("existing-team-connect-in-full")).toBeNull();
  });
});
