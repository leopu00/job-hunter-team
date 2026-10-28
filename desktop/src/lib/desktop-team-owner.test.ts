import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}));

import { invoke, isTauri } from "@tauri-apps/api/core";
import { readDesktopTeamOwnerIdentity } from "./desktop-team-owner";

const digest = "a".repeat(64);
const profile = "b".repeat(64);

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue(undefined);
  vi.mocked(isTauri).mockReset().mockReturnValue(true);
});

describe("the identity of the team's owner", () => {
  it("reads a local profile with its id, an account without one, or nobody", async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce({ ownerScopeDigest: digest, kind: "local", profileId: profile })
      .mockResolvedValueOnce({ ownerScopeDigest: digest, kind: "google" })
      .mockResolvedValueOnce(null);
    await expect(readDesktopTeamOwnerIdentity()).resolves.toEqual({ ownerScopeDigest: digest, kind: "local", profileId: profile });
    await expect(readDesktopTeamOwnerIdentity()).resolves.toEqual({ ownerScopeDigest: digest, kind: "google" });
    await expect(readDesktopTeamOwnerIdentity()).resolves.toBeNull();
    expect(invoke).toHaveBeenCalledWith("runtime_local_team_owner_identity");
    expect(vi.mocked(invoke).mock.calls[0]).toHaveLength(1);
  });

  it("refuses an identity that is not the backend's shape", async () => {
    for (const reply of [
      undefined, {}, { ownerScopeDigest: "short", kind: "google" },
      { ownerScopeDigest: digest, kind: "other" },
      { ownerScopeDigest: digest, kind: "local" },
      { ownerScopeDigest: digest, kind: "local", profileId: "x" },
      { ownerScopeDigest: digest, kind: "google", profileId: profile },
    ]) {
      vi.mocked(invoke).mockReset().mockResolvedValueOnce(reply);
      await expect(readDesktopTeamOwnerIdentity()).rejects.toEqual({ code: "local_account_owner_invalid" });
    }
  });

  it("passes the backend's closed code and is desktop only", async () => {
    vi.mocked(invoke).mockRejectedValueOnce({ code: "invalid_request" });
    await expect(readDesktopTeamOwnerIdentity()).rejects.toEqual({ code: "invalid_request" });
    vi.mocked(invoke).mockReset();
    vi.mocked(isTauri).mockReturnValue(false);
    await expect(readDesktopTeamOwnerIdentity()).rejects.toEqual({ code: "desktop_only" });
    expect(invoke).not.toHaveBeenCalled();
  });
});
