import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  activateDesktopLocalScope,
  createDesktopLocalProfile,
} from "./desktop-account-scope";
import {
  activateSavedLocalProfile,
  clearLocalIdentitySelection,
  createAndActivateLocalProfile,
  localIdentitySelected,
  readLocalProfile,
} from "./local-profile";

vi.mock("./desktop-account-scope", () => ({
  activateDesktopLocalScope: vi.fn(),
  createDesktopLocalProfile: vi.fn(),
}));

beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  vi.mocked(activateDesktopLocalScope).mockResolvedValue();
});

describe("local identity persistence", () => {
  it("keeps the display name on-device and passes only the backend profile ID to scope activation", async () => {
    vi.mocked(createDesktopLocalProfile).mockResolvedValue({ profileId: "opaque-profile-a" });

    await expect(createAndActivateLocalProfile("  Ada   Locale  ")).resolves.toEqual({
      profileId: "opaque-profile-a",
      displayName: "Ada Locale",
    });

    expect(createDesktopLocalProfile).toHaveBeenCalledWith();
    expect(activateDesktopLocalScope).toHaveBeenCalledWith("opaque-profile-a");
    expect(readLocalProfile()).toEqual({ profileId: "opaque-profile-a", displayName: "Ada Locale" });
    expect(localIdentitySelected()).toBe(true);
  });

  it("reactivates the saved backend profile without creating or uploading another identity", async () => {
    vi.mocked(createDesktopLocalProfile).mockResolvedValue({ profileId: "opaque-profile-a" });
    await createAndActivateLocalProfile("Ada Locale");
    vi.clearAllMocks();

    await expect(activateSavedLocalProfile()).resolves.toEqual({
      profileId: "opaque-profile-a",
      displayName: "Ada Locale",
    });

    expect(createDesktopLocalProfile).not.toHaveBeenCalled();
    expect(activateDesktopLocalScope).toHaveBeenCalledWith("opaque-profile-a");
  });

  it("does not select a local identity when the backend rejects its scope", async () => {
    vi.mocked(createDesktopLocalProfile).mockResolvedValue({ profileId: "opaque-profile-b" });
    vi.mocked(activateDesktopLocalScope).mockRejectedValue({ code: "account_scope_mismatch" });

    await expect(createAndActivateLocalProfile("Bea Locale")).rejects.toEqual({
      code: "account_scope_mismatch",
    });
    expect(localIdentitySelected()).toBe(false);
    expect(readLocalProfile()).toEqual({ profileId: "opaque-profile-b", displayName: "Bea Locale" });
  });

  it("clears only the active choice, preserving the local profile for a later return", async () => {
    vi.mocked(createDesktopLocalProfile).mockResolvedValue({ profileId: "opaque-profile-a" });
    await createAndActivateLocalProfile("Ada Locale");
    clearLocalIdentitySelection();
    expect(localIdentitySelected()).toBe(false);
    expect(readLocalProfile()?.displayName).toBe("Ada Locale");
  });
});
