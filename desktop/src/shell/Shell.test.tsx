import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureData } from "../pages/dashboard/dashboard-fixture";
import { loadDashboard } from "../pages/dashboard/load-dashboard";
import { signOut } from "../lib/supabase";
import { installApiBridge, notInDesktop, shellApi } from "./api-bridge";
import { currentLocation, matchRoute, navigate } from "./router";
import { READ_ONLY_NAV, READ_ONLY_ROUTES, ROUTES } from "./routes";
import { desktopLinks } from "./desktop-links";
import { THEME_STORAGE_KEY } from "./theme";
import { enterExistingTeamReadOnly, leaveExistingTeamReadOnly } from "../lib/existing-team-readonly";
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
vi.mock("../pages/office/readonly", () => ({ default: () => <h1>Ufficio del team esistente</h1> }));
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

describe("Shell navbar language", () => {
  afterEach(() => localStorage.removeItem("jht-lang"));

  it("names its own buttons in the app's language, not always in Italian", async () => {
    localStorage.setItem("jht-lang", "en");
    navigate("/", { replace: true });
    render(<Shell />);
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "App navigation" })).toBeInTheDocument();
    const actions = screen.getByTestId("navbar-actions");
    expect(within(actions).getByRole("button", { name: "Refresh" })).toBeInTheDocument();
    expect(within(actions).getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    expect(within(actions).queryByRole("button", { name: "Aggiorna" })).not.toBeInTheDocument();
    expect(within(actions).queryByRole("button", { name: "Esci" })).not.toBeInTheDocument();
  });
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
    for (const label of ["Dashboard", "Mappa", "Swipe", "Team", "Messaggi", "Profilo"]) {
      expect(within(nav).getByRole("link", { name: label })).toBeInTheDocument();
    }
    await user.click(within(nav).getByRole("link", { name: "Mappa" }));
    expect(currentLocation().path).toBe("/map");
    expect(await screen.findByRole("heading", { name: "Mappa" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Mappa" })).toHaveAttribute("aria-current", "page");
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

  it("names the theme picker and its themes in the app's language", async () => {
    document.cookie = "NEXT_LOCALE=en; path=/";
    try {
      navigate("/dashboard", { replace: true });
      const user = userEvent.setup();
      render(<Shell />);
      await user.click(screen.getByRole("button", { name: "Theme: Dark (system). Change theme" }));
      const menu = screen.getByRole("menu", { name: "App theme" });
      expect(within(menu).getByRole("menuitemradio", { name: "Ocean" })).toBeInTheDocument();
      expect(menu).not.toHaveTextContent(/Scuro|Chiaro|Oceano|Carta|Tema/);
    } finally {
      document.cookie = "NEXT_LOCALE=; path=/; max-age=0";
    }
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
  describe("in a window too narrow for every link (1068 px)", () => {
    // jsdom has no layout: the links are 80 px wide, the strip 420 px, as a
    // window of about 1068 px leaves it with ten links.
    const originals = new Map<string, PropertyDescriptor | undefined>();
    beforeEach(() => {
      for (const name of ["offsetWidth", "clientWidth"]) {
        originals.set(name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name));
        Object.defineProperty(HTMLElement.prototype, name, {
          configurable: true,
          get(this: HTMLElement) {
            if (this.tagName === "A") return this.style.display === "none" ? 0 : 80;
            if (this.dataset.testid === "navbar-links") return 420;
            return 0;
          },
        });
      }
    });
    afterEach(() => {
      for (const [name, original] of originals) {
        if (original) Object.defineProperty(HTMLElement.prototype, name, original);
        else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
      }
      originals.clear();
    });

    it("puts the links that do not fit in «Altro», so no link is cut under the buttons, whatever their number", async () => {
      navigate("/dashboard", { replace: true });
      render(<Shell />);
      await screen.findByRole("heading", { name: "Dashboard" });

      const more = within(screen.getByTestId("navbar-more")).getByRole("button", { name: /Altro/ });
      expect(more).toBeInTheDocument();
      const strip = screen.getByTestId("navbar-links-scroll");
      const inStrip = within(strip).getAllByRole("link").filter((link) => (link as HTMLElement).style.display !== "none");
      expect(inStrip.length).toBeLessThan(within(strip).getAllByRole("link", { hidden: true }).length);
      // the controls stay where they were
      expect(within(screen.getByTestId("navbar-actions")).getByRole("button", { name: "Esci" })).toBeInTheDocument();

      await userEvent.setup().click(more);
      const inMenu = within(screen.getByRole("menu")).getAllByRole("menuitem");
      expect(inMenu.length + inStrip.length).toBe(within(strip).getAllByRole("link", { hidden: true }).length);
    });
  });

  it("selects a theme, persists it, and restores it after a reload", async () => {
    navigate("/dashboard", { replace: true });
    const user = userEvent.setup();
    const first = render(<Shell />);

    await user.click(
      screen.getByRole("button", { name: "Tema: Scuro (sistema). Cambia tema" }),
    );
    const menu = screen.getByRole("menu", { name: "Tema dell'app" });
    // «follow the system» and the eleven palettes
    expect(within(menu).getAllByRole("menuitemradio")).toHaveLength(12);
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
    for (const { href, label } of desktopLinks("it")) {
      expect(within(nav).getByRole("link", { name: label })).toHaveAttribute("href", "#" + href);
      expect(matchRoute(ROUTES, href)?.route.path).toBe(href);
    }
    expect(desktopLinks("it").map((l) => l.label)).toEqual(["Agenti", "Ufficio", "Posta", "Impostazioni", "Guida"]);
    expect(within(nav).queryByRole("link", { name: "Budget" })).not.toBeInTheDocument();
    expect(desktopLinks("it").some((link) => link.href === "/budget")).toBe(false);
    expect(matchRoute(ROUTES, "/budget")).toBeNull();
  });

  it("names the desktop's own pages in the app's language, as the mail page names itself", () => {
    expect(desktopLinks("en").map((l) => l.label)).toEqual(["Agents", "Office", "Mail", "Settings", "Help"]);
    expect(desktopLinks("de").map((l) => l.label)).toEqual(["Agenten", "Büro", "E-Mail", "Einstellungen", "Hilfe"]);
    for (const locale of ["it", "en", "de", "fr", "es", "pt", "hu"] as const)
      expect(new Set(desktopLinks(locale).map((l) => l.href))).toEqual(new Set(["/agents", "/office", "/mail", "/settings", "/help"]));
  });

  it("has the settings and help pages in the full shell and in the read-only view of an existing team", async () => {
    for (const path of ["/settings", "/help"]) {
      expect(matchRoute(ROUTES, path)?.route.path).toBe(path);
      expect(matchRoute(READ_ONLY_ROUTES, path)?.route.path).toBe(path);
      expect(READ_ONLY_NAV.some((entry) => entry.href === path)).toBe(true);
    }

    enterExistingTeamReadOnly(true, null);
    try {
      navigate("/dashboard", { replace: true });
      render(<Shell />);
      const nav = await screen.findByRole("navigation", { name: "Navigazione app" });
      expect(within(nav).getByRole("link", { name: "Impostazioni" })).toHaveAttribute("href", "#/settings");
      expect(within(nav).getByRole("link", { name: "Guida" })).toHaveAttribute("href", "#/help");
    } finally {
      leaveExistingTeamReadOnly();
    }
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

  it("gives the office the whole window in the read-only view of an existing team too, its bars above it", async () => {
    enterExistingTeamReadOnly(true, null);
    try {
      navigate("/office", { replace: true });
      render(<Shell />);
      const office = await screen.findByRole("heading", { name: "Ufficio del team esistente" });
      const bleed = office.closest("main")!;
      expect(bleed).toHaveAttribute("data-testid", "full-bleed");
      const column = bleed.parentElement!;
      expect(column.style.height).toBe("calc(100svh / var(--zoom, 1))");
      expect(column.style.overflow).toBe("hidden");
      // the read-only banner stays, inside the column and outside the page
      const banner = screen.getByTestId("existing-team-readonly-banner");
      expect(column).toContainElement(banner);
      expect(bleed).not.toContainElement(banner);
    } finally {
      leaveExistingTeamReadOnly();
    }
  });

  it.each(["/team", "/team/log", "/team/scout", "/team/analista", "/team/scorer", "/team/scrittore", "/team/critico"])(
    "has a page for the web's %s",
    (path) => {
      expect(matchRoute(ROUTES, path)?.route.path).toBe(path);
    },
  );
});
