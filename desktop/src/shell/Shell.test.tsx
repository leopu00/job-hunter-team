import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureData } from "../pages/dashboard/dashboard-fixture";
import { loadDashboard } from "../pages/dashboard/load-dashboard";
import { signOut } from "../lib/supabase";
import { installApiBridge, notInDesktop, shellApi } from "./api-bridge";
import { currentLocation, matchRoute, navigate } from "./router";
import { READ_ONLY_ROUTES, ROUTES } from "./routes";
import { ACCOUNT_MENU_ITEMS, NAV_ITEMS, READ_ONLY_ACCOUNT_MENU_ITEMS, READ_ONLY_NAV_ITEMS } from "./nav-items";
import { NAV_TEXT } from "./nav.i18n";
import { redirectFor } from "./redirects";
import { THEME_STORAGE_KEY } from "./theme";
import { downgradeExistingTeamToReadOnly, enterExistingTeamReadOnly, leaveExistingTeamReadOnly } from "../lib/existing-team-readonly";
import { announceRestoredWriteAccess, reportWriteAccessRemovalFailed, writeAccessNotice } from "../lib/write-access-restored";
import { EXISTING_TEAM_READONLY_TEXT } from "../lib/existing-team-readonly.i18n";
import { EXIT_OPEN_EVENT } from "../lib/app-exit";
import Shell from "./Shell";
import { SHELL_TEXT } from "./shell.i18n";

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

/** The ways out and the person\'s pages are in the account menu: open it, then the item. */
async function accountMenu(user = userEvent.setup()) {
  await user.click(screen.getByTestId("account-menu-button"));
  return within(screen.getByRole("menu", { name: /Menu dell'account|Account menu/ }));
}

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
    const menu = await accountMenu();
    expect(menu.getByRole("menuitem", { name: "Sign out" })).toBeInTheDocument();
    expect(menu.getByRole("menuitem", { name: "Settings" })).toBeInTheDocument();
    expect(menu.getByRole("menuitem", { name: "Profile" })).toBeInTheDocument();
    expect(within(actions).queryByRole("button", { name: "Aggiorna" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Disconnetti" })).not.toBeInTheDocument();
  });
});

describe("Shell", () => {
  it("has a button that leaves the app apart from the one that leaves the account, and it asks the exit dialog", async () => {
    navigate("/", { replace: true });
    render(<Shell />);
    await screen.findByTestId("navbar-actions");
    const menu = await accountMenu();
    expect(menu.getByRole("menuitem", { name: "Disconnetti" })).toBeInTheDocument();
    const asked = vi.fn();
    window.addEventListener(EXIT_OPEN_EVENT, asked);
    await userEvent.setup().click(menu.getByRole("menuitem", { name: "Esci da Job Hunter Team" }));
    window.removeEventListener(EXIT_OPEN_EVENT, asked);
    expect(asked).toHaveBeenCalledOnce();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("lands on the dashboard when the hash says nothing", async () => {
    navigate("/", { replace: true });
    render(<Shell />);
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(currentLocation().path).toBe("/dashboard");
  });

  it("ignores a dashboard read that settles after the Shell unmounts", async () => {
    let resolve!: (value: ReturnType<typeof fixtureData>) => void;
    vi.mocked(loadDashboard).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    navigate("/dashboard", { replace: true });
    const calls = vi.mocked(loadDashboard).mock.calls.length;
    const page = render(<Shell />);

    page.unmount();
    await act(async () => { resolve(fixtureData()); });
    expect(vi.mocked(loadDashboard)).toHaveBeenCalledTimes(calls + 1);
  });

  it("has the web's navigation, in the app's language, and moves between pages", async () => {
    navigate("/dashboard", { replace: true });
    const user = userEvent.setup();
    render(<Shell />);
    const nav = screen.getByRole("navigation", { name: "Navigazione app" });
    // The labels come from the web's dictionary once /api/i18n answers "it".
    await within(nav).findByRole("link", { name: "Posizioni" });
    for (const label of ["Dashboard", "Mappa", "Swipe", "Team", "Ufficio"]) {
      expect(within(nav).getByRole("link", { name: label })).toBeInTheDocument();
    }
    // Messages is the Team page now: one link, not two
    expect(within(nav).queryByRole("link", { name: "Messaggi" })).not.toBeInTheDocument();
    // the person's own pages are in the account menu, not in the bar
    for (const label of ["Profilo", "Impostazioni", "Guida", "Posta", "Agenti"]) {
      expect(within(nav).queryByRole("link", { name: label })).not.toBeInTheDocument();
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
      expect(within(menu).getByRole("menuitemradio", { name: "Graphite" })).toBeInTheDocument();
      expect(within(menu).getByRole("menuitemradio", { name: "High contrast light" })).toBeInTheDocument();
      expect(menu).not.toHaveTextContent(/Scuro|Chiaro|Grafite|Grigio|Tema/);
    } finally {
      document.cookie = "NEXT_LOCALE=; path=/; max-age=0";
    }
  });

  it("says what «Disconnetti» does and does not remove: the person, not the data", async () => {
    navigate("/dashboard", { replace: true });
    render(<Shell />);
    await screen.findByRole("heading", { name: "Dashboard" });

    const button = (await accountMenu()).getByRole("menuitem", { name: "Disconnetti" });
    expect(button).toHaveAttribute("title", SHELL_TEXT.it.signOutNote);
    // True for a team on this computer and on a VPS alike: it says what is not deleted, not where it is.
    expect(SHELL_TEXT.it.signOutNote).toMatch(/non vengono cancellati/);
    expect(SHELL_TEXT.it.signOutNote).not.toMatch(/questo computer/);
  });

  it("keeps the signed-in shell mounted when scoped logout teardown fails", async () => {
    vi.mocked(signOut).mockRejectedValue({ code: "account_scope_reset_failed" });
    navigate("/dashboard", { replace: true });
    const user = userEvent.setup();
    render(<Shell />);
    await screen.findByRole("heading", { name: "Dashboard" });

    await user.click((await accountMenu(user)).getByRole("menuitem", { name: "Disconnetti" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/runtime resta bloccato/i);
    expect((await accountMenu(user)).getByRole("menuitem", { name: "Disconnetti" })).toBeEnabled();
  });

  it("uses the local logout boundary and keeps Shell mounted if its teardown fails", async () => {
    const localLogout = vi.fn().mockRejectedValue({ code: "account_scope_reset_failed" });
    navigate("/dashboard", { replace: true });
    const user = userEvent.setup();
    render(<Shell onLogout={localLogout} />);
    await screen.findByRole("heading", { name: "Dashboard" });

    await user.click((await accountMenu(user)).getByRole("menuitem", { name: "Disconnetti" }));

    expect(localLogout).toHaveBeenCalledOnce();
    expect(signOut).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(/runtime resta bloccato/i);
    expect((await accountMenu(user)).getByRole("menuitem", { name: "Disconnetti" })).toBeEnabled();
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
      // Only the horizontal axis is cut: `overflow-hidden` would clip the «More ▾» menu hanging under the bar.
      expect(nav.className).toMatch(/overflow-x-clip/);
      expect(nav.className).not.toMatch(/overflow-hidden|overflow-y-/);
      expect(links.className).toMatch(/min-w-0/);
      expect(links.className).toMatch(/flex-1/);
      expect(links.className).toMatch(/overflow-x-auto/);
      expect(actions.className).toMatch(/flex-shrink-0/);
      expect(within(actions).getByRole("button", { name: "Aggiorna" })).toBeInTheDocument();
      expect(within(actions).getByTestId("account-menu-button")).toBeInTheDocument();
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
      expect(within(screen.getByTestId("navbar-actions")).getByTestId("account-menu-button")).toBeInTheDocument();

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
    // «follow the system» and the six ready palettes, three dark and three light; the coloured templates are not entries
    expect(within(menu).getAllByRole("menuitemradio").map((item) => item.textContent?.replace("✓", "").trim())).toEqual([
      "Segui il sistema", "Scuro", "Grafite", "Alto contrasto", "Chiaro", "Grigio chiaro", "Alto contrasto chiaro",
    ]);
    expect(within(menu).queryByRole("menuitemradio", { name: "Oceano" })).toBeNull();
    await user.click(within(menu).getByRole("menuitemradio", { name: "Grafite" }));

    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("graphite");
    expect(document.documentElement).toHaveAttribute("data-jht-theme", "graphite");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(
      screen.getByRole("button", { name: "Tema: Grafite. Cambia tema" }),
    ).toBeInTheDocument();

    first.unmount();
    document.documentElement.removeAttribute("data-jht-theme");
    document.documentElement.removeAttribute("data-theme");
    render(<Shell />);

    expect(
      screen.getByRole("button", { name: "Tema: Grafite. Cambia tema" }),
    ).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute("data-jht-theme", "graphite");
  });

  it("keeps the coloured palette of who chose one before it became a template, and shows it checked in the menu", async () => {
    localStorage.setItem(THEME_STORAGE_KEY, "forest");
    navigate("/dashboard", { replace: true });
    const user = userEvent.setup();
    render(<Shell />);

    expect(document.documentElement).toHaveAttribute("data-jht-theme", "forest");
    await user.click(screen.getByRole("button", { name: "Tema: Foresta. Cambia tema" }));
    const menu = screen.getByRole("menu", { name: "Tema dell'app" });
    expect(within(menu).getByRole("menuitemradio", { name: /Foresta/ })).toHaveAttribute("aria-checked", "true");
    expect(within(menu).queryByRole("menuitemradio", { name: /Oceano/ })).toBeNull();
    // once another palette is chosen, the template leaves the menu
    await user.click(within(menu).getByRole("menuitemradio", { name: "Scuro" }));
    await user.click(screen.getByRole("button", { name: "Tema: Scuro. Cambia tema" }));
    expect(within(screen.getByRole("menu")).queryByRole("menuitemradio", { name: /Foresta/ })).toBeNull();
  });

  it("keeps the bar to the positions and the team, and the person's pages in the account menu, and routes to all of them", async () => {
    navigate("/dashboard", { replace: true });
    render(<Shell />);
    const nav = screen.getByRole("navigation", { name: "Navigazione app" });
    // every destination of the bar has a page
    for (const item of NAV_ITEMS) {
      expect(matchRoute(ROUTES, item.href)?.route.path).toBe(item.href);
    }
    expect(NAV_ITEMS.map((item) => item.href)).toEqual(["/dashboard", "/positions", "/swipe", "/map", "/messages", "/office", "/budget"]);
    const links = within(screen.getByTestId("navbar-links")).getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(links).toEqual(["#/dashboard", "#/positions", "#/swipe", "#/map", "#/messages", "#/office", "#/budget"]);
    // Team is the page of the agents and of the chat, and stays lit on the old Agents address and on the team's activity page
    expect(NAV_ITEMS.find((item) => item.label && "web" in item.label && item.label.web === "nav_team")?.also).toEqual(["/agents", "/team"]);
    // Budget has its page in the routes, so its entry in the bar is lit
    expect(within(nav).getByRole("link", { name: "Budget" })).toHaveAttribute("href", "#/budget");
    expect(matchRoute(ROUTES, "/budget")?.route.path).toBe("/budget");
    const menu = await accountMenu();
    for (const item of ACCOUNT_MENU_ITEMS) {
      // Settings is the page of its sections: its own address goes on to one of them
      if (item.href === "/settings") expect(redirectFor(item.href, "")).toMatch(/^\/settings\//);
      else expect(matchRoute(ROUTES, item.href)?.route.path).toBe(item.href);
    }
    expect(menu.getAllByRole("menuitem").map((entry) => entry.textContent)).toEqual(["Profilo", "Posta", "Impostazioni", "Guida", "Esci da Job Hunter Team", "Disconnetti"]);
    expect(menu.getByRole("menuitem", { name: "Impostazioni" })).toHaveAttribute("href", "#/settings");
  });

  it("names the account menu's pages in the app's language, as the pages name themselves", () => {
    expect(NAV_TEXT.en).toMatchObject({ office: "Office", mail: "Mail", settings: "Settings", help: "Help", profile: "Profile" });
    expect(NAV_TEXT.de).toMatchObject({ office: "Büro", mail: "E-Mail", settings: "Einstellungen", help: "Hilfe" });
    for (const locale of ["it", "en", "de", "fr", "es", "pt", "hu"] as const)
      for (const word of Object.values(NAV_TEXT[locale])) expect(word.trim().length, locale).toBeGreaterThan(0);
  });

  it("has the settings and help pages in the full shell and in the read-only view of an existing team", async () => {
    for (const path of ["/settings/appearance", "/help"]) {
      expect(matchRoute(ROUTES, path)).not.toBeNull();
      expect(matchRoute(READ_ONLY_ROUTES, path)).not.toBeNull();
    }
    for (const path of ["/settings", "/help"]) {
      expect(READ_ONLY_ACCOUNT_MENU_ITEMS.some((entry) => entry.href === path)).toBe(true);
    }
    expect(READ_ONLY_NAV_ITEMS.map((entry) => entry.href)).toEqual(["/dashboard", "/positions", "/map", "/team", "/office"]);

    enterExistingTeamReadOnly(true, null);
    try {
      navigate("/dashboard", { replace: true });
      render(<Shell />);
      await screen.findByRole("navigation", { name: "Navigazione app" });
      const menu = await accountMenu();
      expect(menu.getByRole("menuitem", { name: "Impostazioni" })).toHaveAttribute("href", "#/settings");
      expect(menu.getByRole("menuitem", { name: "Guida" })).toHaveAttribute("href", "#/help");
      expect(menu.queryByRole("menuitem", { name: "Posta" })).not.toBeInTheDocument();
    } finally {
      leaveExistingTeamReadOnly();
    }
  });

  it("shows the fixed row of a restored full connection in the full shell, in the office's column and in the read-only view", async () => {
    // a restored connection opens in full: the row is under the navbar, in the page's column and in the office's
    enterExistingTeamReadOnly(true, null, "account:x|full", true);
    announceRestoredWriteAccess();
    try {
      for (const path of ["/dashboard", "/office"]) {
        navigate(path, { replace: true });
        const view = render(<Shell />);
        expect(await screen.findByTestId("write-access-restored")).toBeInTheDocument();
        view.unmount();
      }
      // the person switched to read only and the saved record could not be taken away: the read-only view says so
      downgradeExistingTeamToReadOnly();
      reportWriteAccessRemovalFailed("existing_team_full_link_not_removed");
      navigate("/dashboard", { replace: true });
      render(<Shell />);
      expect(await screen.findByTestId("write-access-removal-failed")).toBeInTheDocument();
      expect(screen.getByTestId("existing-team-readonly-banner")).toBeInTheDocument();
    } finally {
      leaveExistingTeamReadOnly();
    }
    expect(writeAccessNotice()).toBeNull();
  });

  it("says in the read-only banner why the write access did not come back, and says nothing when it was never given", async () => {
    const text = EXISTING_TEAM_READONLY_TEXT.it;
    const reasons = { not_restored: text.becauseNotRestored, expired: text.becauseExpired, discarded: text.becauseDiscarded } as const;
    try {
      for (const [because, sentence] of Object.entries(reasons)) {
        enterExistingTeamReadOnly(true, null, `account:x|${because}`, undefined, because as keyof typeof reasons);
        navigate("/dashboard", { replace: true });
        const view = render(<Shell />);
        expect(await screen.findByTestId("existing-team-readonly-why")).toHaveTextContent(sentence);
        view.unmount();
        leaveExistingTeamReadOnly();
      }
      // a team never connected in full also gets «not_restored»: its sentence claims no permission of the past
      expect(text.becauseNotRestored).not.toMatch(/mantenut|ultima volta|confermat|scadut/i);
      expect(EXISTING_TEAM_READONLY_TEXT.en.becauseNotRestored).not.toMatch(/kept|last time|confirmed|expired/i);
      enterExistingTeamReadOnly(true, null, "account:x|plain");
      navigate("/dashboard", { replace: true });
      render(<Shell />);
      expect(await screen.findByTestId("existing-team-readonly-banner")).toBeInTheDocument();
      expect(screen.queryByTestId("existing-team-readonly-why")).toBeNull();
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
    expect(ROUTES.filter((r) => r.fullBleed).map((r) => r.path).sort()).toEqual(["/agents/:name", "/messages", "/office", "/swipe"]);
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
