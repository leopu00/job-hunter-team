import { readFileSync } from "node:fs";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureData } from "../pages/dashboard/dashboard-fixture";
import { loadDashboard } from "../pages/dashboard/load-dashboard";
import { enterExistingTeamReadOnly, leaveExistingTeamReadOnly } from "../lib/existing-team-readonly";
import { installApiBridge, notInDesktop, shellApi } from "./api-bridge";
import { currentLocation, matchRoute, navigate } from "./router";
import { READ_ONLY_ROUTES } from "./routes";
import Shell from "./Shell";

vi.mock("../lib/supabase", () => ({ supabase: { from: vi.fn() }, supabaseConfigured: true, signOut: vi.fn() }));
vi.mock("../pages/work-hours", () => ({ default: () => <h1>Pagina orari</h1> }));
vi.mock("../pages/team-settings", () => ({ default: () => <h1>Pagina modelli</h1> }));
vi.mock("../pages/dashboard/load-dashboard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../pages/dashboard/load-dashboard")>()),
  loadDashboard: vi.fn(),
}));

// The settings of a team on a linked VPS: «Working hours», «Team models» and «Budget» opened the dashboard
// (the route table of the linked view had no such paths). Synthetic data only.
let restore: () => void;
beforeEach(() => {
  document.cookie = "NEXT_LOCALE=it; path=/";
  localStorage.setItem("jht-lang", "it");
  restore = installApiBridge(shellApi(notInDesktop));
  vi.mocked(loadDashboard).mockResolvedValue(fixtureData());
});
afterEach(() => {
  cleanup();
  leaveExistingTeamReadOnly();
  restore();
  localStorage.removeItem("jht-lang");
  document.cookie = "NEXT_LOCALE=; path=/; max-age=0";
});

describe("the settings pages of a team on a linked VPS", () => {
  it("opens the hours and the models on a team connected in full, and stays on their address", async () => {
    for (const [path, title] of [["/settings/hours", "Pagina orari"], ["/settings/team", "Pagina modelli"]] as const) {
      enterExistingTeamReadOnly(true, null, "vps-1", true);
      navigate(path, { replace: true });
      const { unmount } = render(<Shell />);
      expect(await screen.findByRole("heading", { name: title })).toBeInTheDocument();
      expect(currentLocation().path).toBe(path);
      unmount();
      leaveExistingTeamReadOnly();
    }
  });

  it("on the read-only link says why they do not open, with the reason, and does not leave the address", async () => {
    for (const path of ["/settings/hours", "/settings/team"]) {
      enterExistingTeamReadOnly(true, null, "vps-1");
      navigate(path, { replace: true });
      const { unmount } = render(<Shell />);
      const gate = await screen.findByTestId("linked-gate");
      expect(gate).toHaveTextContent("Solo lettura: questa connessione non modifica i dati.");
      expect(gate).toHaveTextContent("Per cambiarli usa «Collega in scrittura»");
      expect(screen.queryByRole("heading", { name: /Pagina (orari|modelli)/ })).not.toBeInTheDocument();
      expect(currentLocation().path).toBe(path);
      unmount();
      leaveExistingTeamReadOnly();
    }
  });

  it("has a route for every address the settings page and its team card send the person to", () => {
    const sources = ["../pages/settings/index.tsx", "../pages/settings/TeamCard.tsx"].map((file) =>
      readFileSync(new URL(file, import.meta.url), "utf8"),
    );
    const targets = new Set(sources.flatMap((source) => [...source.matchAll(/navigate\("([^"]+)"\)/g)].map((match) => match[1])));
    expect(targets.size).toBeGreaterThanOrEqual(6);
    for (const target of targets) expect(matchRoute(READ_ONLY_ROUTES, target), target).not.toBeNull();
  });
});
