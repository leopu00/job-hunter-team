import { beforeEach, describe, expect, it, vi } from "vitest";
import { EXPORT_FORMATS, EXPORT_SOURCES, exportTeamData, saveAccountExport } from "./team-export";
import { ERROR_CATALOG } from "./error-catalog";

const native = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true) }));
vi.mock("@tauri-apps/api/core", () => native);

beforeEach(() => {
  native.invoke.mockReset();
  native.isTauri.mockReturnValue(true);
});

describe("team export", () => {
  it("offers the contract's closed lists, and none of the web's retired sources", () => {
    expect([...EXPORT_SOURCES]).toEqual(["positions", "scores", "applications", "companies", "feedback", "notes"]);
    expect([...EXPORT_FORMATS]).toEqual(["json", "csv"]);
    for (const retired of ["sessions", "tasks", "analytics", "jobs", "contacts", "interviews"]) {
      expect((EXPORT_SOURCES as readonly string[]).includes(retired)).toBe(false);
    }
  });

  it("asks for a team export with the request as it is and answers the rows written", async () => {
    native.invoke.mockResolvedValue({ outcome: "saved", count: 42 });
    const request = { source: "positions", format: "csv", from: "2026-01-01", to: "2026-03-31" } as const;
    expect(await exportTeamData(request)).toEqual({ ok: true, outcome: "saved", count: 42 });
    expect(native.invoke).toHaveBeenCalledExactlyOnceWith("export_team_data", { request });
  });

  it("closing the save window is not an error", async () => {
    native.invoke.mockResolvedValue({ outcome: "cancelled" });
    expect(await exportTeamData({ source: "notes", format: "json" })).toEqual({ ok: true, outcome: "cancelled" });
    expect(await saveAccountExport("{}")).toEqual({ ok: true, outcome: "cancelled" });
  });

  it("the account's text goes as it is and its answer has no count", async () => {
    native.invoke.mockResolvedValue({ outcome: "saved", count: 9 });
    const text = JSON.stringify({ account: { id: "u" }, data: {} });
    expect(await saveAccountExport(text)).toEqual({ ok: true, outcome: "saved" });
    expect(native.invoke).toHaveBeenCalledExactlyOnceWith("export_account_save", { text });
  });

  it("an error of the native side is its closed code", async () => {
    native.invoke.mockRejectedValue({ code: "export_range_invalid" });
    expect(await exportTeamData({ source: "scores", format: "json", from: "x" })).toEqual({ ok: false, error: "export_range_invalid" });
    native.invoke.mockRejectedValue({ code: "disconnected" });
    expect(await exportTeamData({ source: "scores", format: "json" })).toEqual({ ok: false, error: "disconnected" });
  });

  it.each([undefined, null, "saved", 5, {}, { outcome: "done" }, { outcome: 7 }])("a reply that is not an outcome (%j) is a failed save, never a success", async (reply) => {
    native.invoke.mockResolvedValue(reply);
    expect(await exportTeamData({ source: "companies", format: "json" })).toEqual({ ok: false, error: "export_save_failed" });
    expect(await saveAccountExport("{}")).toEqual({ ok: false, error: "export_save_failed" });
  });

  it.each([undefined, new Error("boom"), "text", {}, { code: "" }, { code: 3 }])("an error with no code (%j) is a failed save", async (error) => {
    native.invoke.mockRejectedValue(error);
    expect(await exportTeamData({ source: "companies", format: "json" })).toEqual({ ok: false, error: "export_save_failed" });
  });

  it("a count that is not a count is not shown", async () => {
    for (const count of [-1, 1.5, "7", null, Number.NaN]) {
      native.invoke.mockResolvedValue({ outcome: "saved", count });
      expect(await exportTeamData({ source: "companies", format: "json" })).toEqual({ ok: true, outcome: "saved" });
    }
  });

  it("outside the desktop nothing is called", async () => {
    native.isTauri.mockReturnValue(false);
    expect(await exportTeamData({ source: "positions", format: "json" })).toEqual({ ok: false, error: "desktop_only" });
    expect(await saveAccountExport("{}")).toEqual({ ok: false, error: "desktop_only" });
    expect(native.invoke).not.toHaveBeenCalled();
  });

  it("every code the export can answer has a sentence in the error catalog", () => {
    for (const code of ["export_source_invalid", "export_range_invalid", "export_no_database", "export_too_large", "export_save_failed", "private_unavailable", "export_incomplete", "not_cloud", "disconnected", "tunnel_unavailable", "read_failed", "invalid_request"]) {
      expect(code in ERROR_CATALOG, code).toBe(true);
    }
  });
});
