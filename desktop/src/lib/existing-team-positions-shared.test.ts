import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The positions read shared by the globe and the office's panels of the read-only view: kept for
// a few seconds, and only for the connection it was read on. Two fake VPS one after the other, well
// inside those seconds: the second team's positions, never the first's. Synthetic data only.
const native = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("./existing-team-positions", () => ({ readDesktopVpsPositions: native.read, readDesktopVpsMap: native.read }));

import { enterExistingTeamReadOnly, leaveExistingTeamReadOnly } from "./existing-team-readonly";
import { readVpsPositionsShared, resetVpsPositionsShared } from "./existing-team-positions-shared";
import { vpsPanelLoaders } from "../office/panel/vps-panels";
import { mapApi } from "../pages/map/map-api";
import { notInDesktop } from "../shell/api-bridge";

const team = (place: string, city: string) => ({
  source: "vps" as const,
  data: [{ id: `${place}-1`, title: `Synthetic role ${place}`, company: `Synthetic ${place}`, status: "scored",
    location: place, remote_type: "onsite", found_at: "2026-10-01T09:00:00Z", loc_country: "Italy", loc_city: city }],
});
const VPS_A = { identity: "account:synthetic|vps:a.example.invalid:22|team:synthetic-team-a", read: team("Milano", "Milano") };
const VPS_B = { identity: "account:synthetic|vps:b.example.invalid:22|team:synthetic-team-b", read: team("Torino", "Torino") };

function connect(vps: { identity: string; read: unknown }) {
  native.read.mockResolvedValue(vps.read);
  enterExistingTeamReadOnly(false, null, vps.identity);
}

beforeEach(() => {
  native.read.mockReset();
  resetVpsPositionsShared();
});
afterEach(() => leaveExistingTeamReadOnly());

describe("the shared positions read of the read-only view", () => {
  it("is shared within one connection", async () => {
    connect(VPS_A);
    await readVpsPositionsShared(1_000);
    await readVpsPositionsShared(2_000);
    expect(native.read).toHaveBeenCalledTimes(1);
  });

  it("the globe: another VPS within the 5 s reads again and shows the second team", async () => {
    const api = mapApi(notInDesktop);
    connect(VPS_A);
    const first = await (await api("/api/positions/locations")).json();
    expect(first.map((country: { cities: Array<{ city: string }> }) => country.cities[0].city)).toEqual(["Milano"]);
    leaveExistingTeamReadOnly();
    connect(VPS_B);
    const second = await (await api("/api/positions/locations")).json();
    expect(second.map((country: { cities: Array<{ city: string }> }) => country.cities[0].city)).toEqual(["Torino"]);
    expect(native.read).toHaveBeenCalledTimes(2);
  });

  it("an office panel: another VPS within the 5 s reads again and shows the second team", async () => {
    connect(VPS_A);
    expect((await vpsPanelLoaders.places()).places).toEqual([{ place: "Milano", n: 1 }]);
    leaveExistingTeamReadOnly();
    connect(VPS_B);
    expect((await vpsPanelLoaders.places()).places).toEqual([{ place: "Torino", n: 1 }]);
    expect(native.read).toHaveBeenCalledTimes(2);
  });

  it("another connection opened without closing the view first reads again too", async () => {
    connect(VPS_A);
    await readVpsPositionsShared(1_000);
    connect(VPS_B);
    expect(await readVpsPositionsShared(1_500)).toBe(VPS_B.read);
    expect(native.read).toHaveBeenCalledTimes(2);
  });

  it("a read that comes back after another VPS was opened is not given to it", async () => {
    let answer: (value: unknown) => void = () => undefined;
    connect(VPS_A);
    native.read.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    const late = readVpsPositionsShared(1_000);
    connect(VPS_B);
    answer(VPS_A.read);
    expect(await late).toEqual({ source: "unavailable", code: "existing_team_target_changed" });
    expect(await readVpsPositionsShared(1_100)).toBe(VPS_B.read);
  });

  it("keeps nothing while the view is closed", async () => {
    native.read.mockResolvedValue(VPS_A.read);
    await readVpsPositionsShared(1_000);
    await readVpsPositionsShared(1_100);
    expect(native.read).toHaveBeenCalledTimes(2);
  });
});
