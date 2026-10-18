import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  syntheticDetail as detail,
  syntheticFacets as facets,
  syntheticPosition as position,
} from "../test-support/existing-team-positions-fixture";
import {
  readDesktopVpsPosition,
  readDesktopVpsPositionFacets,
  readDesktopVpsPositions,
  readDesktopVpsPositionsWindow,
  readDesktopVpsStats,
} from "./existing-team-positions";
import { syntheticStats } from "../test-support/existing-team-stats-fixture";
import { enterExistingTeamReadOnly, leaveExistingTeamReadOnly, existingTeamReadOnly } from "./existing-team-readonly";

const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => native);

beforeEach(() => {
  native.invoke.mockReset();
  native.isTauri.mockReturnValue(true);
});

describe("existing-team positions bridge", () => {
  it("uses one fixed native command and only a bounded list projection", async () => {
    native.invoke.mockResolvedValue({ ok: true, data: { items: [position] } });

    await expect(readDesktopVpsPositions({ statuses: ["scored"], q: "synthetic" })).resolves.toEqual({
      source: "vps",
      data: [position],
    });
    expect(native.invoke).toHaveBeenCalledWith("existing_team_positions_read", {
      request: { op: "list", filters: { statuses: ["scored"], q: "synthetic" } },
    });
    const request = native.invoke.mock.calls[0]?.[1]?.request as Record<string, unknown>;
    expect(request).not.toHaveProperty("sql");
    expect(request).not.toHaveProperty("host");
    expect(request).not.toHaveProperty("containerId");
  });

  it("omits filters only when no filter object was supplied", async () => {
    native.invoke
      .mockResolvedValueOnce({ ok: true, data: { items: [] } })
      .mockResolvedValueOnce({ ok: true, data: { items: [] } });

    await expect(readDesktopVpsPositions()).resolves.toEqual({ source: "vps", data: [] });
    await expect(readDesktopVpsPositions({ q: "synthetic" })).resolves.toEqual({
      source: "vps",
      data: [],
    });
    expect(native.invoke).toHaveBeenNthCalledWith(1, "existing_team_positions_read", {
      request: { op: "list" },
    });
    expect(native.invoke).toHaveBeenNthCalledWith(2, "existing_team_positions_read", {
      request: { op: "list", filters: { q: "synthetic" } },
    });
  });

  it("reads a list larger than the native bound in bounded replies, in order", async () => {
    const rows = (from: number, count: number) =>
      Array.from({ length: count }, (_unused, index) => ({ ...position, id: String(from + index) }));
    native.invoke
      .mockResolvedValueOnce({ ok: true, data: { items: rows(0, 600) } })
      .mockResolvedValueOnce({ ok: true, data: { items: rows(600, 600) } })
      .mockResolvedValueOnce({ ok: true, data: { items: rows(1200, 100) } });

    const result = await readDesktopVpsPositions({ q: "synthetic", sort: "score", limit: 1300 });

    expect(result.source === "vps" && result.data.map((row) => row.id)).toEqual(rows(0, 1300).map((row) => row.id));
    expect(native.invoke.mock.calls.map(([, args]) => args.request.filters)).toEqual([
      { q: "synthetic", sort: "score", limit: 600, offset: 0 },
      { q: "synthetic", sort: "score", limit: 600, offset: 600 },
      { q: "synthetic", sort: "score", limit: 100, offset: 1200 },
    ]);
  });

  it("stops at the first short reply and keeps a requested offset", async () => {
    native.invoke.mockResolvedValueOnce({ ok: true, data: { items: [position] } });

    await expect(readDesktopVpsPositions({ limit: 2000, offset: 40 })).resolves.toEqual({
      source: "vps",
      data: [position],
    });
    expect(native.invoke).toHaveBeenCalledTimes(1);
    expect(native.invoke).toHaveBeenCalledWith("existing_team_positions_read", {
      request: { op: "list", filters: { limit: 600, offset: 40 } },
    });
  });

  it("returns the failure, not a partial list, when a later reply fails", async () => {
    native.invoke
      .mockResolvedValueOnce({ ok: true, data: { items: Array.from({ length: 600 }, () => position) } })
      .mockResolvedValueOnce({ ok: false, error: "positions_unavailable" });

    await expect(readDesktopVpsPositions({ limit: 2000 })).resolves.toEqual({
      source: "unavailable",
      code: "positions_unavailable",
    });
  });

  it("reads one page with the count the core made, in one bounded request", async () => {
    native.invoke.mockResolvedValueOnce({ ok: true, data: { items: [position], total: 137 } });

    await expect(
      readDesktopVpsPositionsWindow({ q: "synthetic", sort: "score", dir: "desc", limit: 25, offset: 50, scoredOnly: true, hideExcluded: true }),
    ).resolves.toEqual({ source: "vps", data: { items: [position], total: 137 } });
    expect(native.invoke).toHaveBeenCalledTimes(1);
    expect(native.invoke).toHaveBeenCalledWith("existing_team_positions_read", {
      request: {
        op: "list",
        filters: { q: "synthetic", sort: "score", dir: "desc", limit: 25, offset: 50, scoredOnly: true, hideExcluded: true },
      },
    });
  });

  it("refuses a page whose count is missing or not a count", async () => {
    for (const data of [{ items: [position] }, { items: [position], total: "3" }, { items: [position], total: -1 }, { total: 1 }]) {
      native.invoke.mockResolvedValueOnce({ ok: true, data });
      await expect(readDesktopVpsPositionsWindow({ limit: 25 })).resolves.toEqual({
        source: "unavailable",
        code: "desktop_bad_reply",
      });
    }
  });

  it("asks for the date order by name when the sort is one the core rows cannot carry, and says so", async () => {
    enterExistingTeamReadOnly(false);
    try {
      native.invoke.mockResolvedValue({ ok: true, data: { items: [], total: 0 } });
      await readDesktopVpsPositionsWindow({ sort: "last_action_at", dir: "asc", limit: 25 });
      expect(native.invoke).toHaveBeenLastCalledWith("existing_team_positions_read", {
        request: { op: "list", filters: { sort: "found_at", dir: "asc", limit: 25 } },
      });
      expect(existingTeamReadOnly()).not.toBeNull();
      await readDesktopVpsPositionsWindow({ sort: "score", limit: 25 });
      expect(native.invoke).toHaveBeenLastCalledWith("existing_team_positions_read", {
        request: { op: "list", filters: { sort: "score", limit: 25 } },
      });
    } finally {
      leaveExistingTeamReadOnly();
    }
  });

  it("reads the core's stats in one fixed request and refuses a reply that is not whole", async () => {
    const good = syntheticStats();
    native.invoke.mockResolvedValueOnce({ ok: true, data: good });
    await expect(readDesktopVpsStats()).resolves.toEqual({ source: "vps", data: good });
    expect(native.invoke).toHaveBeenCalledWith("existing_team_positions_read", { request: { op: "stats" } });

    const { points: _points, ...withoutPoints } = good;
    const { events: _events, ...withoutEvents } = good;
    for (const data of [
      withoutPoints,
      withoutEvents,
      { ...good, points: { rows: [], included: -1, of: 0 } },
      { ...good, points: { rows: "no", included: 0, of: 0 } },
      { ...good, stats: [] },
      { ...good, recent: {} },
      null,
    ]) {
      native.invoke.mockResolvedValueOnce({ ok: true, data });
      await expect(readDesktopVpsStats()).resolves.toEqual({ source: "unavailable", code: "desktop_bad_reply" });
    }
    native.invoke.mockResolvedValueOnce({ ok: false, error: "positions_unavailable" });
    await expect(readDesktopVpsStats()).resolves.toEqual({ source: "unavailable", code: "positions_unavailable" });
  });

  it("preserves related detail and correlated facets from fixed operations", async () => {
    native.invoke
      .mockResolvedValueOnce({ ok: true, data: detail })
      .mockResolvedValueOnce({ ok: true, data: { items: facets } });

    await expect(readDesktopVpsPosition("101")).resolves.toEqual({ source: "vps", data: detail });
    await expect(readDesktopVpsPositionFacets()).resolves.toEqual({ source: "vps", data: facets });
    expect(native.invoke).toHaveBeenNthCalledWith(1, "existing_team_positions_read", {
      request: { op: "detail", id: "101" },
    });
    expect(native.invoke).toHaveBeenNthCalledWith(2, "existing_team_positions_read", {
      request: { op: "facets" },
    });
    expect(detail.score?.position_id).toBe(detail.position.id);
    expect(detail.highlights[0]?.position_id).toBe(detail.position.id);
    expect(detail.application?.position_id).toBe(detail.position.id);
    expect(detail.tickets[0]?.position_id).toBe(detail.position.id);
    expect(detail.company?.id).toBe(detail.position.company_id);
    expect(facets.map((facet) => [facet.id, facet.company, facet.score, facet.loc_country])).toEqual([
      ["101", "Synthetic Co A", 91, "AA"],
      ["102", "Synthetic Co B", 64, "BB"],
    ]);
  });

  it("gives a detail without legacy_id the row's id as box id, and keeps one the core sends", async () => {
    // What the team's jobs.db really yields: no legacy_id column, so null.
    const real = { ...detail, position: { ...detail.position, id: "37", legacy_id: null } };
    native.invoke
      .mockResolvedValueOnce({ ok: true, data: real })
      .mockResolvedValueOnce({ ok: true, data: { ...detail, position: { ...detail.position, id: "37", legacy_id: 12 } } })
      .mockResolvedValueOnce({ ok: true, data: { ...detail, position: { ...detail.position, id: "a1b2", legacy_id: null } } });

    const read = await readDesktopVpsPosition("37");
    expect(read).toEqual({ source: "vps", data: { ...real, position: { ...real.position, legacy_id: 37 } } });
    // Nothing else of the reply changes, and the reply itself is not rewritten.
    expect(real.position.legacy_id).toBeNull();
    await expect(readDesktopVpsPosition("37")).resolves.toMatchObject({ data: { position: { id: "37", legacy_id: 12 } } });
    // An id that is not a box row's number gives no box id.
    await expect(readDesktopVpsPosition("a1b2")).resolves.toMatchObject({ data: { position: { legacy_id: null } } });
  });

  it("fails closed for native failure, malformed replies, and non-desktop callers", async () => {
    native.invoke
      .mockResolvedValueOnce({ ok: false, error: "runtime_target_mismatch" })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, data: { items: { not: "a list" } } });
    await expect(readDesktopVpsPositions()).resolves.toEqual({
      source: "unavailable",
      code: "runtime_target_mismatch",
    });
    await expect(readDesktopVpsPositions()).resolves.toEqual({
      source: "unavailable",
      code: "desktop_bad_reply",
    });
    await expect(readDesktopVpsPositions()).resolves.toEqual({
      source: "unavailable",
      code: "desktop_bad_reply",
    });
    native.isTauri.mockReturnValue(false);
    await expect(readDesktopVpsPositions()).resolves.toEqual({ source: "not_desktop" });
    expect(native.invoke).toHaveBeenCalledTimes(3);
  });
});
