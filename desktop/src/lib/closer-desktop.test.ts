import { beforeEach, describe, expect, it, vi } from "vitest";
import { closerDesktopRequest, desktopKey, pngUrl } from "./closer-desktop";
import { png } from "../closer-desktop/fixtures.test-support";
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => native);
beforeEach(() => { native.invoke.mockReset(); });
describe("fixed native desktop bridge", () => {
  it("uses the exact command and one request argument", async () => {
    native.invoke.mockResolvedValue({ ok: true, phase: "absent" });
    expect(await closerDesktopRequest({ op: "descriptor" })).toEqual({ ok: true, phase: "absent" });
    expect(native.invoke).toHaveBeenCalledWith("closer_desktop_request", { request: { op: "descriptor" } });
  });
  it("does not surface native exceptions", async () => {
    native.invoke.mockRejectedValue(new Error("sensitive native diagnostics"));
    expect(await closerDesktopRequest({ op: "descriptor" })).toEqual({ ok: false, error: "desktop_transport_unavailable" });
  });
  it.each([null, "raw", [], { phase: "absent" }])("rejects malformed replies (%s)", async (value) => {
    native.invoke.mockResolvedValue(value);
    expect((await closerDesktopRequest({ op: "descriptor" })).ok).toBe(false);
  });
  it("validates PNG bounds and header before image allocation", () => {
    expect(pngUrl(png(1, 1))).toMatch(/^data:image\/png;base64,/);
    expect(pngUrl(png(1, 1), 1440, 1000)).toBeNull();
    expect(pngUrl(btoa("not a png"))).toBeNull();
    expect(pngUrl("A".repeat(12 * 1024 * 1024))).toBeNull();
  });
  it("maps only supported keys, without clipboard or script commands", () => {
    expect(desktopKey("Enter")).toBe("Return");
    expect(desktopKey("ArrowDown")).toBe("Down");
    expect(desktopKey("é")).toBe("é");
    expect(desktopKey("Meta")).toBeNull();
    expect(desktopKey("\n")).toBeNull();
  });
});
