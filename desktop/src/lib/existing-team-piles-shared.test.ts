import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The office's five pile counts: one read of the core, kept for a few seconds for the profile (or the connection)
// it was read on, shared by whoever asks while it is on its way. Synthetic data only.
const native = vi.hoisted(() => ({ piles: vi.fn(), list: vi.fn() }));
vi.mock("./existing-team-positions", () => ({
  readDesktopVpsPiles: native.piles,
  readDesktopVpsPositions: native.list,
  readDesktopVpsMap: vi.fn(),
}));

import { setLocalTeamData } from "./local-team-data";
import { SHARED_READ_MS, readVpsPilesShared, resetVpsPositionsShared } from "./existing-team-positions-shared";
import { readVpsPiles } from "../office/panel/vps-panels";

const piles = (n: number) => ({ source: "vps" as const, data: { scout: n, analisti: 0, scorer: 0, scrittori: 0, critici: 0 } });

beforeEach(() => {
  native.piles.mockReset();
  native.list.mockReset();
  resetVpsPositionsShared();
  setLocalTeamData("profile-a");
});
afterEach(() => setLocalTeamData(null));

describe("the shared pile counts of a local profile", () => {
  it("are kept for the 5 s, and read again after them", async () => {
    native.piles.mockResolvedValue(piles(3));
    expect(await readVpsPilesShared(1_000)).toEqual(piles(3));
    await readVpsPilesShared(1_000 + SHARED_READ_MS - 1);
    expect(native.piles).toHaveBeenCalledTimes(1);
    await readVpsPilesShared(1_000 + SHARED_READ_MS);
    expect(native.piles).toHaveBeenCalledTimes(2);
  });

  it("are shared by two callers while the read is on its way", async () => {
    let answer: (value: unknown) => void = () => undefined;
    native.piles.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    const first = readVpsPilesShared(1_000);
    const second = readVpsPilesShared(1_100);
    answer(piles(2));
    expect(await first).toEqual(await second);
    expect(native.piles).toHaveBeenCalledTimes(1);
  });

  it("are never given to another profile: it reads again, and a late answer for the first is refused", async () => {
    let answer: (value: unknown) => void = () => undefined;
    native.piles.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    const late = readVpsPilesShared(1_000);
    setLocalTeamData("profile-b");
    native.piles.mockResolvedValueOnce(piles(9));
    expect(await readVpsPilesShared(1_100)).toEqual(piles(9));
    answer(piles(1));
    expect(await late).toEqual({ source: "unavailable", code: "existing_team_target_changed" });
  });

  it("are not kept at all when there is neither a local profile nor an existing team in view", async () => {
    setLocalTeamData(null);
    native.piles.mockResolvedValue(piles(1));
    await readVpsPilesShared(1_000);
    await readVpsPilesShared(1_100);
    expect(native.piles).toHaveBeenCalledTimes(2);
  });
});

describe("readVpsPiles", () => {
  it("gives the counts and does not touch the list", async () => {
    native.piles.mockResolvedValue(piles(4));
    expect(await readVpsPiles()).toEqual({ scout: 4, analisti: 0, scorer: 0, scrittori: 0, critici: 0 });
    expect(native.list).not.toHaveBeenCalled();
  });

  it("counts from the list when the core does not know the count, and from nothing when it fails otherwise", async () => {
    native.piles.mockResolvedValue({ source: "unavailable", code: "positions_request_invalid" });
    native.list.mockResolvedValue({ source: "vps", data: [{ id: "1", status: "new" }, { id: "2", status: "checked" }] });
    expect(await readVpsPiles()).toMatchObject({ scout: 1, analisti: 1 });
    resetVpsPositionsShared();
    native.list.mockClear();
    native.piles.mockResolvedValue({ source: "unavailable", code: "positions_unavailable" });
    expect(await readVpsPiles()).toBeNull();
    expect(native.list).not.toHaveBeenCalled();
  });
});
