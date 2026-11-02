import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureData } from "../pages/dashboard/dashboard-fixture";
import { loadDashboard } from "../pages/dashboard/load-dashboard";
import { installApiBridge, notInDesktop, shellApi } from "./api-bridge";
import { NAV_ITEMS } from "./nav-items";
import { NAV_TEXT } from "./nav.i18n";
import { currentLocation, navigate } from "./router";
import { ROUTES } from "./routes";
import Shell from "./Shell";

vi.mock("../lib/supabase", () => ({ supabase: { from: vi.fn() }, supabaseConfigured: true, signOut: vi.fn() }));
vi.mock("../pages/map", () => ({ default: () => <h1>Mappa</h1> }));
vi.mock("../pages/office", () => ({ default: () => <h1>Ufficio</h1> }));
vi.mock("../pages/dashboard/load-dashboard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../pages/dashboard/load-dashboard")>()),
  loadDashboard: vi.fn(),
}));

let restore: () => void;
beforeEach(() => {
  localStorage.setItem("jht-lang", "it");
  restore = installApiBridge(shellApi(notInDesktop));
  vi.mocked(loadDashboard).mockResolvedValue(fixtureData());
});
afterEach(() => {
  restore();
  localStorage.removeItem("jht-lang");
  sessionStorage.removeItem("onboarding-popup:pending");
});

const barHrefs = () => within(screen.getByTestId("navbar-links")).getAllByRole("link").map((link) => link.getAttribute("href"));

describe("the main bar", () => {
  it("lists the positions and the team in the order of nav-items, without the account's pages", async () => {
    navigate("/dashboard", { replace: true });
    render(<Shell />);
    await screen.findByRole("heading", { name: "Dashboard" });
    expect(barHrefs()).toEqual(NAV_ITEMS.map((item) => `#${item.href}`).filter((href) => href !== "#/budget"));
    expect(barHrefs()).not.toContain("#/profile");
    expect(barHrefs()).not.toContain("#/settings");
  });

  it("shows the Budget link, after the office, the day its page is in the routes — and not before", async () => {
    const budget = { path: "/budget", page: () => <h1>Pagina budget</h1> };
    ROUTES.push(budget);
    try {
      navigate("/dashboard", { replace: true });
      render(<Shell />);
      await screen.findByRole("heading", { name: "Dashboard" });
      expect(barHrefs()).toEqual(NAV_ITEMS.map((item) => `#${item.href}`));
      const link = within(screen.getByTestId("navbar-links")).getByRole("link", { name: "Budget" });
      await userEvent.setup().click(link);
      expect(currentLocation().path).toBe("/budget");
      expect(await screen.findByRole("heading", { name: "Pagina budget" })).toBeInTheDocument();
      expect(link).toHaveAttribute("aria-current", "page");
    } finally {
      ROUTES.splice(ROUTES.indexOf(budget), 1);
    }
  });

  it("keeps Team lit on the agents' panel, which belongs to it", async () => {
    navigate("/agents", { replace: true });
    render(<Shell />);
    const team = await within(screen.getByTestId("navbar-links")).findByRole("link", { name: "Team" });
    expect(team).toHaveAttribute("aria-current", "page");
  });

  it("puts the «!» of a pending setup on Team, and on the account button for the profile", async () => {
    sessionStorage.setItem("onboarding-popup:pending", JSON.stringify({ profile: true, team: true }));
    navigate("/dashboard", { replace: true });
    render(<Shell />);
    await screen.findByRole("heading", { name: "Dashboard" });
    const team = within(screen.getByTestId("navbar-links")).getByRole("link", { name: /Team/ });
    expect(within(team).getByLabelText(NAV_TEXT.it.setupPending)).toBeInTheDocument();
    const button = screen.getByTestId("account-menu-button");
    expect(within(button).getByLabelText(NAV_TEXT.it.setupPending)).toBeInTheDocument();
    await userEvent.setup().click(button);
    expect(within(screen.getByRole("menuitem", { name: /Profilo/ })).getByLabelText(NAV_TEXT.it.setupPending)).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new CustomEvent("onboarding-popup-update", { detail: { profile: false, team: false } }));
    });
    expect(screen.queryByLabelText(NAV_TEXT.it.setupPending)).toBeNull();
  });
});

describe("the account menu", () => {
  it("opens, closes with Escape and when the person clicks elsewhere, and closes on going to a page", async () => {
    navigate("/dashboard", { replace: true });
    const user = userEvent.setup();
    render(<Shell />);
    await screen.findByRole("heading", { name: "Dashboard" });
    const button = screen.getByTestId("account-menu-button");
    expect(button).toHaveAttribute("aria-expanded", "false");
    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu", { name: NAV_TEXT.it.accountMenu })).toBeNull();
    await user.click(button);
    await user.click(document.body);
    expect(screen.queryByRole("menu", { name: NAV_TEXT.it.accountMenu })).toBeNull();
    await user.click(button);
    await user.click(screen.getByRole("menuitem", { name: "Impostazioni" }));
    expect(currentLocation().path).toMatch(/^\/settings\//);
    expect(screen.queryByRole("menu", { name: NAV_TEXT.it.accountMenu })).toBeNull();
  });
});
