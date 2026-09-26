import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureData } from "../pages/dashboard/dashboard-fixture";
import { loadDashboard } from "../pages/dashboard/load-dashboard";
import { installApiBridge, notInDesktop, shellApi } from "./api-bridge";
import { currentLocation, navigate } from "./router";
import Shell from "./Shell";

vi.mock("../lib/supabase", () => ({ supabase: { from: vi.fn() }, supabaseConfigured: true, signOut: vi.fn() }));
// The real map needs WebGL, which jsdom has not: the shell only has to route to it.
vi.mock("../pages/map", () => ({ default: () => <h1>Mappa</h1> }));
vi.mock("../pages/dashboard/load-dashboard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../pages/dashboard/load-dashboard")>()),
  loadDashboard: vi.fn(),
}));

let restore: () => void;
beforeEach(() => {
  restore = installApiBridge(shellApi(notInDesktop));
  vi.mocked(loadDashboard).mockResolvedValue(fixtureData());
});
afterEach(() => restore());

describe("Shell", () => {
  it("lands on the dashboard when the hash says nothing", async () => {
    navigate("/", { replace: true });
    render(<Shell />);
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(currentLocation().path).toBe("/dashboard");
  });

  it("has the web's navigation, in the app's language, and moves between pages", async () => {
    navigate("/dashboard", { replace: true });
    const user = userEvent.setup();
    render(<Shell />);
    const nav = screen.getByRole("navigation", { name: "Navigazione app" });
    // The labels come from the web's dictionary once /api/i18n answers "it".
    await within(nav).findByRole("link", { name: "Posizioni" });
    for (const label of ["Dashboard", "Map", "Swipe", "Team", "Messaggi", "Profilo"]) {
      expect(within(nav).getByRole("link", { name: label })).toBeInTheDocument();
    }
    await user.click(within(nav).getByRole("link", { name: "Map" }));
    expect(currentLocation().path).toBe("/map");
    expect(await screen.findByRole("heading", { name: "Mappa" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Map" })).toHaveAttribute("aria-current", "page");
  });

  it("routes a position link to the position page", async () => {
    navigate("/dashboard", { replace: true });
    const user = userEvent.setup();
    render(<Shell />);
    const links = await screen.findAllByRole("link", { name: /Ruolo sintetico 11/ });
    await user.click(links[0]);
    expect(currentLocation().path).toBe("/positions/pos-11");
    expect(await screen.findByRole("heading", { name: "Posizione" })).toBeInTheDocument();
  });

  it("asks the page for fresh data from the navbar", async () => {
    navigate("/dashboard", { replace: true });
    render(<Shell />);
    await screen.findByRole("heading", { name: "Dashboard" });
    const before = vi.mocked(loadDashboard).mock.calls.length;
    act(() => screen.getByRole("button", { name: "Aggiorna" }).click());
    expect(vi.mocked(loadDashboard).mock.calls.length).toBe(before + 1);
  });
});
