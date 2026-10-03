import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureData } from "../pages/dashboard/dashboard-fixture";
import { loadDashboard } from "../pages/dashboard/load-dashboard";
import { signOut } from "../lib/supabase";
import { installApiBridge, notInDesktop, shellApi } from "./api-bridge";
import { currentLocation, matchRoute, navigate } from "./router";
import { ROUTES } from "./routes";
import { DESKTOP_LINKS } from "./desktop-links";
import { THEME_STORAGE_KEY } from "./theme";
import Shell from "./Shell";

vi.mock("../lib/supabase", () => ({ supabase: { from: vi.fn() }, supabaseConfigured: true, signOut: vi.fn() }));
// The real map needs WebGL, which jsdom has not: the shell only has to route to it.
vi.mock("../pages/map", () => ({ default: () => <h1>Mappa</h1> }));
// The real position page runs the web's page (pages/positions/positions.test.tsx):
// here it only has to receive the route's id.
vi.mock("../pages/position", () => ({
  default: ({ params }: { params: Record<string, string> }) => <h1>Posizione {params.id}</h1>,
}));
// The real office needs WebGL too: here only where the shell puts it.
vi.mock("../pages/office", () => ({ default: () => <h1>Ufficio</h1> }));
vi.mock("../pages/dashboard/load-dashboard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../pages/dashboard/load-dashboard")>()),
  loadDashboard: vi.fn(),
}));

let restore: () => void;
beforeEach(() => {
  localStorage.removeItem(THEME_STORAGE_KEY);
  document.documentElement.removeAttribute("data-jht-theme");
  document.documentElement.removeAttribute("data-theme");
  restore = installApiBridge(shellApi(notInDesktop));
  vi.mocked(loadDashboard).mockResolvedValue(fixtureData());
  vi.mocked(signOut).mockReset().mockResolvedValue();
});
afterEach(() => {
  restore();
  localStorage.removeItem(THEME_STORAGE_KEY);
  document.documentElement.removeAttribute("data-jht-theme");
  document.documentElement.removeAttribute("data-theme");
});

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
    expect(await screen.findByRole("heading", { name: "Posizione pos-11" })).toBeInTheDocument();
  });

  it("asks the page for fresh data from the navbar", async () => {
    navigate("/dashboard", { replace: true });
    render(<Shell />);
    await screen.findByRole("heading", { name: "Dashboard" });
    const before = vi.mocked(loadDashboard).mock.calls.length;
    act(() => screen.getByRole("button", { name: "Aggiorna" }).click());
    expect(vi.mocked(loadDashboard).mock.calls.length).toBe(before + 1);
  });

  it("keeps the signed-in shell mounted when scoped logout teardown fails", async () => {
    vi.mocked(signOut).mockRejectedValue({ code: "account_scope_reset_failed" });
    navigate("/dashboard", { replace: true });
    const user = userEvent.setup();
    render(<Shell />);
    await screen.findByRole("heading", { name: "Dashboard" });

    await user.click(screen.getByRole("button", { name: "Esci" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/runtime resta bloccato/i);
    expect(screen.getByRole("button", { name: "Esci" })).toBeEnabled();
  });

  it("uses the local logout boundary and keeps Shell mounted if its teardown fails", async () => {
    const localLogout = vi.fn().mockRejectedValue({ code: "account_scope_reset_failed" });
    navigate("/dashboard", { replace: true });
    const user = userEvent.setup();
    render(<Shell onLogout={localLogout} />);
    await screen.findByRole("heading", { name: "Dashboard" });

    await user.click(screen.getByRole("button", { name: "Esci" }));

    expect(localLogout).toHaveBeenCalledOnce();
    expect(signOut).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(/runtime resta bloccato/i);
    expect(screen.getByRole("button", { name: "Esci" })).toBeEnabled();
  });

  it.each([820, 480])(
    "keeps the header controls reachable at %spx and confines overflow to the links",
    async (width) => {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
      navigate("/dashboard", { replace: true });
      render(<Shell />);
      await screen.findByRole("heading", { name: "Dashboard" });

      const nav = screen.getByRole("navigation", { name: "Navigazione app" });
      const links = screen.getByTestId("navbar-links-scroll");
      const actions = screen.getByTestId("navbar-actions");
      expect(nav.className).toMatch(/min-w-0/);
      expect(nav.className).toMatch(/overflow-hidden/);
      expect(links.className).toMatch(/min-w-0/);
      expect(links.className).toMatch(/flex-1/);
      expect(links.className).toMatch(/overflow-x-auto/);
      expect(actions.className).toMatch(/flex-shrink-0/);
      expect(within(actions).getByRole("button", { name: "Aggiorna" })).toBeInTheDocument();
      expect(within(actions).getByRole("button", { name: "Esci" })).toBeInTheDocument();
      expect(within(nav).queryByRole("link", { name: /Team locale/i })).not.toBeInTheDocument();
    },
  );
  it("selects a theme, persists it, and restores it after a reload", async () => {
    navigate("/dashboard", { replace: true });
    const user = userEvent.setup();
    const first = render(<Shell />);

    await user.click(
      screen.getByRole("button", { name: "Tema: Scuro. Cambia tema" }),
    );
    const menu = screen.getByRole("menu", { name: "Tema dell'app" });
    expect(within(menu).getAllByRole("menuitemradio")).toHaveLength(5);
    await user.click(within(menu).getByRole("menuitemradio", { name: "Oceano" }));

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("ocean");
    expect(document.documentElement).toHaveAttribute("data-jht-theme", "ocean");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(
      screen.getByRole("button", { name: "Tema: Oceano. Cambia tema" }),
    ).toBeInTheDocument();

    first.unmount();
    document.documentElement.removeAttribute("data-jht-theme");
    document.documentElement.removeAttribute("data-theme");
    render(<Shell />);

    expect(
      screen.getByRole("button", { name: "Tema: Oceano. Cambia tema" }),
    ).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute("data-jht-theme", "ocean");
  });

  it("adds the desktop's own pages after the web's links, and routes to them", async () => {
    navigate("/dashboard", { replace: true });
    render(<Shell />);
    const nav = screen.getByRole("navigation", { name: "Navigazione app" });
    for (const { href, label } of DESKTOP_LINKS) {
      expect(within(nav).getByRole("link", { name: label })).toHaveAttribute("href", "#" + href);
      expect(matchRoute(ROUTES, href)?.route.path).toBe(href);
    }
    expect(DESKTOP_LINKS.map((l) => l.label)).toEqual(["Agenti", "Ufficio"]);
    expect(within(nav).queryByRole("link", { name: "Budget" })).not.toBeInTheDocument();
    expect(DESKTOP_LINKS.some((link) => link.href === "/budget")).toBe(false);
    expect(matchRoute(ROUTES, "/budget")).toBeNull();
  });

  it("exports only its component, so an edit is Fast Refreshed instead of reloading the page", async () => {
    // A component file that also exports data («DESKTOP_LINKS export is
    // incompatible») makes Vite reload the whole page on every edit.
    expect(Object.keys(await import("./Shell"))).toEqual(["default"]);
  });

  it("gives the office the whole window under the navbar, and leaves every other page in the web's MainChrome", async () => {
    navigate("/office", { replace: true });
    const { unmount } = render(<Shell />);
    const office = await screen.findByRole("heading", { name: "Ufficio" });
    const bleed = office.closest("main")!;
    expect(bleed).toHaveAttribute("data-testid", "full-bleed");
    expect(bleed.className).not.toMatch(/max-w|px-|py-/);
    const column = bleed.parentElement!;
    expect(column.style.height).toBe("calc(100svh / var(--zoom, 1))");
    expect(column.style.overflow).toBe("hidden");
    unmount();

    navigate("/dashboard", { replace: true });
    render(<Shell />);
    const dashboard = await screen.findByRole("heading", { name: "Dashboard" });
    expect(dashboard.closest("main")).not.toHaveAttribute("data-testid", "full-bleed");
    expect(ROUTES.filter((r) => r.fullBleed).map((r) => r.path)).toEqual(["/office"]);
  });

  it.each(["/team", "/team/log", "/team/scout", "/team/analista", "/team/scorer", "/team/scrittore", "/team/critico"])(
    "has a page for the web's %s",
    (path) => {
      expect(matchRoute(ROUTES, path)?.route.path).toBe(path);
    },
  );
});
