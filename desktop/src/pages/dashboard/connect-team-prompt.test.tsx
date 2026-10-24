import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectTeamContext } from "../../lib/connect-team";
import { enterExistingTeamReadOnly, leaveExistingTeamReadOnly } from "../../lib/existing-team-readonly";
import { CONNECT_TEAM_PROMPT_TEXT } from "./connect-team.i18n";
import DashboardPage from "./index";

// The dashboard of a set-up profile with no team linked offers «Collega un team»; with a team linked, or
// outside the app's dashboard, it offers nothing. Synthetic data only.
vi.mock("../../lib/supabase", () => ({ supabase: {}, supabaseConfigured: true, signOut: vi.fn() }));
vi.mock("../../shell/router", () => ({ useRefresh: vi.fn() }));
vi.mock("./DashboardScreen", () => ({ default: () => <p>dashboard-screen</p> }));
vi.mock("./load-dashboard", () => ({ loadDashboard: vi.fn().mockResolvedValue({}) }));
vi.mock("../../lib/existing-team-dashboard", () => ({
  ExistingTeamDashboardError: class extends Error {},
  loadExistingTeamDashboard: vi.fn().mockResolvedValue({}),
}));

beforeEach(() => {
  document.cookie = "NEXT_LOCALE=it; path=/";
});
afterEach(() => {
  cleanup();
  leaveExistingTeamReadOnly();
});

describe("«Collega un team» on the dashboard", () => {
  it("is offered with no team linked, and opens the dialog", async () => {
    const open = vi.fn();
    render(
      <ConnectTeamContext.Provider value={{ open, reopen: vi.fn(), unlinked: vi.fn() }}>
        <DashboardPage params={{}} search={new URLSearchParams()} />
      </ConnectTeamContext.Provider>,
    );
    expect(await screen.findByText("dashboard-screen")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: CONNECT_TEAM_PROMPT_TEXT.it.button }));
    expect(open).toHaveBeenCalledOnce();
  });

  it("is not offered where the app provides no way to connect", async () => {
    render(<DashboardPage params={{}} search={new URLSearchParams()} />);
    expect(await screen.findByText("dashboard-screen")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: CONNECT_TEAM_PROMPT_TEXT.it.button })).not.toBeInTheDocument();
  });

  it("is not offered while a team is linked", async () => {
    enterExistingTeamReadOnly(true);
    render(
      <ConnectTeamContext.Provider value={{ open: vi.fn(), reopen: vi.fn(), unlinked: vi.fn() }}>
        <DashboardPage params={{}} search={new URLSearchParams()} />
      </ConnectTeamContext.Provider>,
    );
    await waitFor(() => expect(screen.getByText("dashboard-screen")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: CONNECT_TEAM_PROMPT_TEXT.it.button })).not.toBeInTheDocument();
  });

  it("is said in every language, with its own button", () => {
    for (const [locale, text] of Object.entries(CONNECT_TEAM_PROMPT_TEXT)) {
      for (const [key, value] of Object.entries(text)) expect(value, `${locale}.${key}`).toMatch(/\S/);
    }
    expect(Object.keys(CONNECT_TEAM_PROMPT_TEXT).sort()).toEqual(["de", "en", "es", "fr", "hu", "it", "pt"]);
  });
});
