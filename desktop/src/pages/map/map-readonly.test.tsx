import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enterExistingTeamReadOnly, leaveExistingTeamReadOnly } from "../../lib/existing-team-readonly";
import { describeError } from "../../lib/error-catalog";
import { installApiBridge, notInDesktop, shellApi } from "../../shell/api-bridge";
import { navigate } from "../../shell/router";
import Shell from "../../shell/Shell";
import { createPermissiveSupabase } from "../../test-support/permissive-supabase";
import { mapApi, resetMapVpsRead } from "./map-api";

// The globe on an existing team that is only read: its three routes answered from the team's
// own positions on the VPS (a stand-in here), with the web's placement and no cloud read.
// Synthetic data only.
const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
const fake = vi.hoisted(() => ({ current: null as ReturnType<typeof createPermissiveSupabase> | null }));
const cloud = vi.hoisted(() => ({ coords: vi.fn(), noCoords: vi.fn(), locations: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => native);
vi.mock("../../lib/supabase", () => ({
  get supabase() {
    return fake.current!.client;
  },
  supabaseConfigured: true,
  signOut: vi.fn(),
}));
vi.mock("@/lib/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queries")>()),
  getPositionsWithCoords: cloud.coords,
  getPositionsWithoutCoords: cloud.noCoords,
  getPositionLocations: cloud.locations,
}));
// The real globe needs WebGL, which jsdom has not: the page is a stand-in, its data routes are real.
vi.mock("../map", () => ({ default: () => <h1>Mappa</h1> }));
vi.mock("../office", () => ({ default: () => <h1>Ufficio</h1> }));

const row = (id: string, extra: Record<string, unknown>) => ({
  id, legacy_id: null, title: `Synthetic role ${id}`, company: `Synthetic company ${id}`, location: null,
  remote_type: "onsite", source: "synthetic", found_at: "2026-10-01T09:00:00Z", status: "scored",
  role_family: "engineering", loc_country: null, loc_city: null, score: 70, ...extra,
});
const ROWS = [
  row("1", { loc_country: "Italy", loc_city: "Milano" }),
  row("2", { loc_country: "Italy", loc_city: "Milan", score: 88 }),
  row("3", {}), // no place at all
  row("4", { loc_country: "Italy", loc_city: "Milano", status: "excluded" }),
];

let restoreBridge: () => void = () => undefined;
const listReads = () => native.invoke.mock.calls.filter(([, args]) => (args as { request?: { op?: string } })?.request?.op === "list");

beforeEach(() => {
  fake.current = createPermissiveSupabase();
  document.cookie = "NEXT_LOCALE=it; path=/";
  native.invoke.mockReset();
  native.invoke.mockImplementation(async () => ({ ok: true, data: { items: ROWS, total: ROWS.length } }));
  cloud.coords.mockReset(); cloud.noCoords.mockReset(); cloud.locations.mockReset();
  resetMapVpsRead();
  restoreBridge = installApiBridge(shellApi(mapApi(notInDesktop)));
  enterExistingTeamReadOnly(false);
});
afterEach(() => {
  cleanup();
  restoreBridge();
  leaveExistingTeamReadOnly();
});

const get = async (path: string) => {
  const response = await fetch(path);
  expect(response.status, path).toBe(200);
  return response.json();
};

describe("the map on an existing team read only", () => {
  it("is a page of that view, with its entry in the navigation", async () => {
    navigate("/map", { replace: true });
    render(<Shell />);
    expect(await screen.findByRole("heading", { name: "Mappa" })).toBeInTheDocument();
    expect(window.location.hash).toMatch(/^#\/map/);
    const nav = screen.getByRole("navigation", { name: "Navigazione app" });
    expect(within(nav).getByRole("link", { name: "Map" })).toHaveAttribute("aria-current", "page");
  });

  it("feeds the globe from the team's positions on the VPS, with the web's placement and no cloud read", async () => {
    const coords = await get("/api/positions/coords");
    // two Milan positions, placed on the web's grid north of the city's centre; the excluded one is not shown
    expect(coords.map((pin: { id: string }) => pin.id).sort()).toEqual(["1", "2"]);
    for (const pin of coords) {
      expect(Math.abs(pin.lat - 45.4642)).toBeLessThan(0.1);
      expect(Math.abs(pin.lon - 9.19)).toBeLessThan(0.1);
      expect(pin.office_address).toBeNull();
    }
    expect(coords.find((pin: { id: string }) => pin.id === "2")).toMatchObject({ score: 88, loc_city: "Milan" });
    // one read of the VPS serves the globe's three routes
    await get("/api/positions/no-coords");
    await get("/api/positions/locations");
    expect(listReads()).toHaveLength(1);
    expect(cloud.coords).not.toHaveBeenCalled();
    expect(cloud.noCoords).not.toHaveBeenCalled();
    expect(cloud.locations).not.toHaveBeenCalled();
    expect(fake.current!.calls).toEqual([]);
  });

  it("puts a position without a place in the list without coordinates, never on an invented point", async () => {
    const noCoords = await get("/api/positions/no-coords");
    expect(noCoords.map((item: { id: string }) => item.id)).toEqual(["3"]);
    const coords = await get("/api/positions/coords");
    expect(coords.some((pin: { id: string }) => pin.id === "3")).toBe(false);
    const locations = await get("/api/positions/locations");
    const countries = locations.map((country: { country: string; count: number }) => [country.country, country.count]);
    expect(countries).toEqual([["Italy", 2], ["(unknown)", 1]]);
  });

  it("refuses anything but a read of those routes", async () => {
    expect((await fetch("/api/positions/coords", { method: "POST" })).status).toBe(403);
  });

  it("on a failed read of the VPS shows an empty globe and the catalog's sentence, never cloud data", async () => {
    native.invoke.mockImplementation(async () => ({ ok: false, error: "positions_unavailable" }));
    navigate("/map", { replace: true });
    render(<Shell />);
    expect(await screen.findByRole("heading", { name: "Mappa" })).toBeInTheDocument();
    expect(await get("/api/positions/coords")).toEqual([]);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(describeError("positions_unavailable", { locale: "it" }).text);
    expect(cloud.coords).not.toHaveBeenCalled();
  });

  it("outside that view still answers from the web's queries", async () => {
    leaveExistingTeamReadOnly();
    cloud.coords.mockResolvedValue([{ id: "cloud" }]);
    expect(await get("/api/positions/coords")).toEqual([{ id: "cloud" }]);
    expect(listReads()).toHaveLength(0);
    await waitFor(() => expect(cloud.coords).toHaveBeenCalledTimes(1));
  });
});
