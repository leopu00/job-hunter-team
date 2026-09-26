import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { goTo, LOGIN_PAGE, SETUP_PAGE } from "../lib/pages";
import DashboardApp from "./DashboardApp";
import { fixtureData } from "../pages/dashboard/dashboard-fixture";
import { loadDashboard } from "../pages/dashboard/load-dashboard";
import { useSession } from "../lib/supabase";

vi.mock("../lib/supabase", () => ({
  supabase: { from: vi.fn() },
  supabaseConfigured: true,
  useSession: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("../lib/pages", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/pages")>()),
  goTo: vi.fn(),
}));
vi.mock("../pages/dashboard/load-dashboard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../pages/dashboard/load-dashboard")>()),
  loadDashboard: vi.fn(),
}));

type SessionState = ReturnType<typeof useSession>;
const signedIn = { session: { user: { id: "user-1" } }, loading: false } as unknown as SessionState;

describe("DashboardApp", () => {
  beforeEach(() => {
    vi.mocked(loadDashboard).mockReset().mockResolvedValue(fixtureData());
    vi.mocked(goTo).mockReset();
  });

  it("sends whoever has no session to the Google sign-in", () => {
    vi.mocked(useSession).mockReturnValue({ session: null, loading: false });
    render(<DashboardApp />);
    expect(goTo).toHaveBeenCalledWith(LOGIN_PAGE);
    expect(loadDashboard).not.toHaveBeenCalled();
  });

  it("waits for the saved session before deciding", () => {
    vi.mocked(useSession).mockReturnValue({ session: null, loading: true });
    render(<DashboardApp />);
    expect(goTo).not.toHaveBeenCalled();
  });

  it("opens on the user's dashboard once signed in", async () => {
    vi.mocked(useSession).mockReturnValue(signedIn);
    render(<DashboardApp />);
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(loadDashboard).toHaveBeenCalled();
  });

  it("keeps the local team setup one click away", async () => {
    vi.mocked(useSession).mockReturnValue(signedIn);
    render(<DashboardApp />);
    expect(await screen.findByRole("link", { name: "Team locale" })).toHaveAttribute("href", SETUP_PAGE);
  });
});
