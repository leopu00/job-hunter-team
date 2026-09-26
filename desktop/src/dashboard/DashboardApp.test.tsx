import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DashboardApp, { SETUP_PAGE } from "./DashboardApp";
import { fixtureData } from "./dashboard-fixture";
import { loadDashboard } from "./load-dashboard";
import { useSession } from "../lib/supabase";

vi.mock("../lib/supabase", () => ({
  supabase: { from: vi.fn() },
  supabaseConfigured: true,
  useSession: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("../components/login-screen", () => ({
  LoginScreen: () => <p>login-screen</p>,
}));
vi.mock("./load-dashboard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./load-dashboard")>()),
  loadDashboard: vi.fn(),
}));

type SessionState = ReturnType<typeof useSession>;
const signedIn = { session: { user: { id: "user-1" } }, loading: false } as unknown as SessionState;

describe("DashboardApp", () => {
  beforeEach(() => {
    vi.mocked(loadDashboard).mockResolvedValue(fixtureData());
  });

  it("asks for the Google sign-in while there is no session", () => {
    vi.mocked(useSession).mockReturnValue({ session: null, loading: false });
    render(<DashboardApp />);
    expect(screen.getByText("login-screen")).toBeInTheDocument();
    expect(loadDashboard).not.toHaveBeenCalled();
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
