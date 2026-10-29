import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  syntheticDetail as detail,
  syntheticFacets as facets,
  syntheticPosition as position,
} from "../test-support/existing-team-positions-fixture";
import {
  readDesktopVpsPosition,
  readDesktopVpsPositionFacets,
  readDesktopVpsMap,
  readDesktopVpsPiles,
  readDesktopVpsPositions,
  resetCachedReads,
  readDesktopVpsPositionsWindow,
  readDesktopVpsStats,
} from "./existing-team-positions";
import { syntheticStats } from "../test-support/existing-team-stats-fixture";
import { enterExistingTeamReadOnly, leaveExistingTeamReadOnly, existingTeamReadOnly } from "./existing-team-readonly";
import { startVpsLink, stopVpsLink, vpsLinkState } from "./vps-link";
import { REFRESH_EVENT } from "../shell/refresh-event";

const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => native);

beforeEach(() => {
  resetCachedReads();
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

  it("reads the five pile counts of the office in one request that carries nothing but the op", async () => {
    native.invoke.mockResolvedValueOnce({ ok: true, data: { scout: 4, analisti: 3, scorer: 2, scrittori: 1, critici: 0, extra: "ignored" } });
    expect(await readDesktopVpsPiles()).toEqual({ source: "vps", data: { scout: 4, analisti: 3, scorer: 2, scrittori: 1, critici: 0 } });
    expect(native.invoke).toHaveBeenCalledTimes(1);
    expect(native.invoke).toHaveBeenCalledWith("existing_team_positions_read", { request: { op: "piles" } });
  });

  it("refuses counts that are not five whole numbers, and passes on the core's own refusal", async () => {
    for (const data of [{}, { scout: 1 }, { scout: -1, analisti: 0, scorer: 0, scrittori: 0, critici: 0 }, { scout: "3", analisti: 0, scorer: 0, scrittori: 0, critici: 0 }, { scout: 1.5, analisti: 0, scorer: 0, scrittori: 0, critici: 0 }, [], null]) {
      native.invoke.mockResolvedValueOnce({ ok: true, data });
      expect(await readDesktopVpsPiles(), JSON.stringify(data)).toEqual({ source: "unavailable", code: "desktop_bad_reply" });
    }
    native.invoke.mockResolvedValueOnce({ ok: false, error: "positions_request_invalid" });
    expect(await readDesktopVpsPiles()).toEqual({ source: "unavailable", code: "positions_request_invalid" });
  });

  it("reads what the globe draws in one request, and follows `next` for a team that does not fit in one reply", async () => {
    const rows = (from: number, count: number) => Array.from({ length: count }, (_unused, index) => ({ id: String(from + index) }));
    native.invoke.mockResolvedValueOnce({ ok: true, data: { items: rows(0, 2380), total: 2380, next: null } });
    const one = await readDesktopVpsMap();
    expect(one.source === "vps" && one.data).toHaveLength(2380);
    expect(native.invoke).toHaveBeenCalledTimes(1);
    expect(native.invoke).toHaveBeenCalledWith("existing_team_positions_read", { request: { op: "map", offset: 0 } });

    native.invoke.mockReset();
    native.invoke
      .mockResolvedValueOnce({ ok: true, data: { items: rows(0, 5000), total: 7000, next: 5000 } })
      .mockResolvedValueOnce({ ok: true, data: { items: rows(5000, 2000), total: 7000, next: null } });
    const two = await readDesktopVpsMap();
    expect(two.source === "vps" && two.data.map((row) => row.id)).toEqual(rows(0, 7000).map((row) => row.id));
    expect(native.invoke.mock.calls.map(([, args]) => args.request)).toEqual([{ op: "map", offset: 0 }, { op: "map", offset: 5000 }]);
  });

  it("the globe's read is a failure, never a part of the map, when a reply fails, is odd or does not move forward", async () => {
    const reply = (next: unknown) => ({ ok: true, data: { items: [{ id: "1" }], total: 5, next } });
    native.invoke.mockResolvedValueOnce(reply(1)).mockResolvedValueOnce({ ok: false, error: "positions_unavailable" });
    await expect(readDesktopVpsMap()).resolves.toEqual({ source: "unavailable", code: "positions_unavailable" });
    for (const odd of [{ ok: true, data: { items: "x", total: 1, next: null } }, { ok: true, data: { items: [], total: -1, next: null } },
      { ok: true, data: { items: [], total: 1, next: "2" } }, { ok: true, data: { items: [], total: 1 } }]) {
      native.invoke.mockReset();
      native.invoke.mockResolvedValueOnce(odd);
      await expect(readDesktopVpsMap()).resolves.toEqual({ source: "unavailable", code: "desktop_bad_reply" });
    }
    native.invoke.mockReset();
    native.invoke.mockResolvedValue(reply(0));
    await expect(readDesktopVpsMap()).resolves.toEqual({ source: "unavailable", code: "desktop_bad_reply" });
    expect(native.invoke).toHaveBeenCalledTimes(1);
    native.isTauri.mockReturnValue(false);
    await expect(readDesktopVpsMap()).resolves.toEqual({ source: "not_desktop" });
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

  // The header of the link replaced the old «list not read» line: every read that line used to
  // complain about has to leave a state in the header, and a working read has to leave «connected».
  it.each([
    ["a network failure", { ok: false, error: "timeout", kind: "network" }, "reconnecting", "timeout"],
    ["the team answering with an error", { ok: false, error: "existing_team_not_active", kind: "application" }, "application", "existing_team_not_active"],
    ["a team that is not the pinned one", { ok: false, error: "runtime_target_mismatch", kind: "version" }, "version", "runtime_target_mismatch"],
    ["a changed SSH key", { ok: false, error: "host_key_changed", kind: "blocked" }, "blocked", "host_key_changed"],
    ["a failure with no kind", { ok: false, error: "runtime_data_unavailable" }, "application", "runtime_data_unavailable"],
    ["a reply that says ok and carries no data", { ok: true }, "application", "desktop_bad_reply"],
    ["a reply that is not an object", "nope", "application", "desktop_bad_reply"],
    ["a reply with neither ok nor error", { data: {} }, "application", "desktop_bad_reply"],
  ])("leaves a state in the header for %s", async (_name, answer, status, code) => {
    startVpsLink(true);
    native.invoke.mockResolvedValueOnce(answer);
    await readDesktopVpsPositions();
    expect(vpsLinkState()).toMatchObject({ status, code });
    stopVpsLink();
  });

  it("leaves a state in the header when the native call itself fails, and 'connected' after a working read", async () => {
    startVpsLink(false);
    native.invoke.mockRejectedValueOnce(new Error("no binding"));
    await readDesktopVpsPositions();
    expect(vpsLinkState()).toMatchObject({ status: "application", code: "desktop_transport_unavailable" });
    native.invoke.mockResolvedValueOnce({ ok: true, data: { items: [] } });
    await readDesktopVpsPositions();
    expect(vpsLinkState()).toMatchObject({ status: "connected", code: null });
    stopVpsLink();
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


describe("the facets and the dashboard's numbers kept between pages of a linked team", () => {
  const FACETS = { ok: true, data: { items: [{ id: "1" }] } };
  const asked = (op: string) => native.invoke.mock.calls.filter(([, args]) => args.request.op === op).length;

  afterEach(() => {
    leaveExistingTeamReadOnly();
    vi.useRealTimers();
  });

  it("reads them once for 30 s on one connection, and again after that", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000_000);
    enterExistingTeamReadOnly(false, null, "account:synthetic|vps:a.example.invalid:22|team:one");
    native.invoke.mockResolvedValue(FACETS);
    await readDesktopVpsPositionFacets();
    await readDesktopVpsPositionFacets();
    expect(asked("facets")).toBe(1);
    vi.setSystemTime(1_029_000);
    await readDesktopVpsPositionFacets();
    expect(asked("facets")).toBe(1);
    vi.setSystemTime(1_031_000);
    await readDesktopVpsPositionFacets();
    expect(asked("facets")).toBe(2);
  });

  it("keeps the facets and the numbers apart, and the numbers the same way", async () => {
    enterExistingTeamReadOnly(false, null, "account:synthetic|vps:a.example.invalid:22|team:one");
    native.invoke.mockImplementation(async (_command, args) => (args.request.op === "stats" ? { ok: true, data: syntheticStats } : FACETS));
    await readDesktopVpsPositionFacets();
    await readDesktopVpsStats();
    await readDesktopVpsStats();
    await readDesktopVpsPositionFacets();
    expect([asked("facets"), asked("stats")]).toEqual([1, 1]);
  });

  it("forgets them when a page is asked to read again, and on another connection", async () => {
    enterExistingTeamReadOnly(false, null, "account:synthetic|vps:a.example.invalid:22|team:one");
    native.invoke.mockResolvedValue(FACETS);
    await readDesktopVpsPositionFacets();
    window.dispatchEvent(new CustomEvent(REFRESH_EVENT));
    await readDesktopVpsPositionFacets();
    expect(asked("facets")).toBe(2);
    enterExistingTeamReadOnly(false, null, "account:synthetic|vps:b.example.invalid:22|team:two");
    await readDesktopVpsPositionFacets();
    expect(asked("facets")).toBe(3);
  });

  it("keeps nothing with the view closed, and never a read that failed", async () => {
    native.invoke.mockResolvedValue(FACETS);
    await readDesktopVpsPositionFacets();
    await readDesktopVpsPositionFacets();
    expect(asked("facets")).toBe(2);
    enterExistingTeamReadOnly(false, null, "account:synthetic|vps:a.example.invalid:22|team:one");
    native.invoke.mockReset();
    native.invoke.mockResolvedValueOnce({ ok: false, error: "positions_unavailable" }).mockResolvedValueOnce(FACETS);
    await expect(readDesktopVpsPositionFacets()).resolves.toEqual({ source: "unavailable", code: "positions_unavailable" });
    await expect(readDesktopVpsPositionFacets()).resolves.toEqual({ source: "vps", data: [{ id: "1" }] });
    expect(asked("facets")).toBe(2);
  });
});
