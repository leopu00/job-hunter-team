import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}));

import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  activateDesktopAccountScope,
  activateDesktopLocalScope,
  clearDesktopAccountScope,
  createDesktopLocalProfile,
} from "./desktop-account-scope";

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue(undefined);
  vi.mocked(isTauri).mockReset().mockReturnValue(true);
});

describe("desktop account scope boundary", () => {
  it("lets only the authenticated backend derive the opaque scope", async () => {
    await activateDesktopAccountScope();
    expect(invoke).toHaveBeenCalledWith("runtime_account_scope_set");
    expect(vi.mocked(invoke).mock.calls[0]).toHaveLength(1);
  });

  it("creates and activates a backend-issued local profile without sending its display name", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ profileId: "opaque-local-capability" });
    await expect(createDesktopLocalProfile()).resolves.toEqual({ profileId: "opaque-local-capability" });
    await activateDesktopLocalScope("opaque-local-capability");

    expect(invoke).toHaveBeenNthCalledWith(1, "runtime_local_profile_create");
    expect(vi.mocked(invoke).mock.calls[0]).toHaveLength(1);
    expect(invoke).toHaveBeenNthCalledWith(2, "runtime_account_scope_set_local", {
      profileId: "opaque-local-capability",
    });
    expect(JSON.stringify(vi.mocked(invoke).mock.calls)).not.toContain("Nome Locale");
  });

  it("serializes account changes and logout teardown", async () => {
    let releaseFirst!: () => void;
    vi.mocked(invoke).mockImplementationOnce(() => new Promise<void>((resolve) => {
      releaseFirst = resolve;
    }));

    const accountA = activateDesktopAccountScope();
    const clear = clearDesktopAccountScope();
    const accountB = activateDesktopAccountScope();
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    releaseFirst();
    await Promise.all([accountA, clear, accountB]);

    expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual([
      "runtime_account_scope_set",
      "runtime_account_scope_reset",
      "runtime_account_scope_set",
    ]);
  });

  it("fails closed outside the desktop runtime", async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    await expect(activateDesktopAccountScope()).rejects.toEqual({ code: "desktop_only" });
    expect(invoke).not.toHaveBeenCalled();
  });
});
