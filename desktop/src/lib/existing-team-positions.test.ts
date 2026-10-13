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
} from "./existing-team-positions";

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
