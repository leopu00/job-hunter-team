import { beforeEach, describe, expect, it, vi } from "vitest";
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
    native.invoke.mockResolvedValue({ ok: true, data: [] });

    await expect(readDesktopVpsPositions({ statuses: ["scored"], q: "synthetic" })).resolves.toEqual({
      source: "vps",
      data: [],
    });
    expect(native.invoke).toHaveBeenCalledWith("existing_team_positions_read", {
      request: { op: "list", filters: { statuses: ["scored"], q: "synthetic" } },
    });
    const request = native.invoke.mock.calls[0]?.[1]?.request as Record<string, unknown>;
    expect(request).not.toHaveProperty("sql");
    expect(request).not.toHaveProperty("host");
    expect(request).not.toHaveProperty("containerId");
  });

  it("uses fixed detail and facets operations", async () => {
    native.invoke.mockResolvedValueOnce({ ok: true, data: null }).mockResolvedValueOnce({ ok: true, data: [] });

    await expect(readDesktopVpsPosition("42")).resolves.toEqual({ source: "vps", data: null });
    await expect(readDesktopVpsPositionFacets()).resolves.toEqual({ source: "vps", data: [] });
    expect(native.invoke).toHaveBeenNthCalledWith(1, "existing_team_positions_read", {
      request: { op: "detail", id: "42" },
    });
    expect(native.invoke).toHaveBeenNthCalledWith(2, "existing_team_positions_read", {
      request: { op: "facets" },
    });
  });

  it("fails closed for native failure, malformed replies, and non-desktop callers", async () => {
    native.invoke
      .mockResolvedValueOnce({ ok: false, error: "runtime_target_mismatch" })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, data: { not: "a list" } });
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
