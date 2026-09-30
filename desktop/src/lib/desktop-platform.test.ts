import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readDesktopPlatform } from "./desktop-platform";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("desktop platform contract", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(["windows", "macos", "linux"] as const)("accepts the native %s target", async (platform) => {
    vi.mocked(invoke).mockResolvedValue(platform);
    await expect(readDesktopPlatform()).resolves.toBe(platform);
    expect(invoke).toHaveBeenCalledWith("desktop_platform");
  });

  it.each(["freebsd", "", null, { platform: "windows" }])("fails closed for invalid value %j", async (platform) => {
    vi.mocked(invoke).mockResolvedValue(platform);
    await expect(readDesktopPlatform()).resolves.toBe("other");
  });

  it("fails closed when the native contract is unavailable", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("unavailable"));
    await expect(readDesktopPlatform()).resolves.toBe("other");
  });
});
