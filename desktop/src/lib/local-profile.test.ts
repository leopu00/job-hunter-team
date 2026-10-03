import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  activateDesktopLocalScope,
  createDesktopLocalProfile,
  recoverDesktopPlaygroundLocalOrphan,
  resetDesktopPlaygroundLocalScope,
} from "./desktop-account-scope";
import {
  activateSavedLocalProfile,
  clearLocalIdentitySelection,
  createAndActivateLocalProfile,
  createAndActivatePlaygroundLocalProfile,
  localIdentitySelected,
  readLocalProfile,
  resetPlaygroundLocalProfile,
} from "./local-profile";

vi.mock("./desktop-account-scope", () => ({
  activateDesktopLocalScope: vi.fn(),
  createDesktopLocalProfile: vi.fn(),
  recoverDesktopPlaygroundLocalOrphan: vi.fn(),
  resetDesktopPlaygroundLocalScope: vi.fn(),
}));

beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  vi.mocked(activateDesktopLocalScope).mockResolvedValue();
  vi.mocked(recoverDesktopPlaygroundLocalOrphan).mockResolvedValue(false);
  vi.mocked(resetDesktopPlaygroundLocalScope).mockResolvedValue();
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

  it("awaits orphan recovery before creating playground profile B", async () => {
    let releaseRecovery!: () => void;
    vi.mocked(recoverDesktopPlaygroundLocalOrphan).mockReturnValue(
      new Promise<boolean>((resolve) => {
        releaseRecovery = () => resolve(true);
      }),
    );
    vi.mocked(createDesktopLocalProfile).mockResolvedValue({ profileId: "opaque-profile-b" });

    const creating = createAndActivatePlaygroundLocalProfile("Bea Locale");
    await vi.waitFor(() => expect(recoverDesktopPlaygroundLocalOrphan).toHaveBeenCalledOnce());
    expect(createDesktopLocalProfile).not.toHaveBeenCalled();
    expect(activateDesktopLocalScope).not.toHaveBeenCalled();

    releaseRecovery();
    await expect(creating).resolves.toEqual({
      profileId: "opaque-profile-b",
      displayName: "Bea Locale",
    });
    expect(createDesktopLocalProfile).toHaveBeenCalledOnce();
    expect(activateDesktopLocalScope).toHaveBeenCalledWith("opaque-profile-b");
  });

  it("blocks B and coalesces concurrent creation when orphan recovery fails", async () => {
    let rejectRecovery!: (error: unknown) => void;
    vi.mocked(recoverDesktopPlaygroundLocalOrphan).mockReturnValue(
      new Promise<boolean>((_resolve, reject) => {
        rejectRecovery = reject;
      }),
    );

    const first = createAndActivatePlaygroundLocalProfile("Bea Locale");
    const second = createAndActivatePlaygroundLocalProfile("Bea duplicata");
    expect(second).toBe(first);
    await vi.waitFor(() => expect(recoverDesktopPlaygroundLocalOrphan).toHaveBeenCalledOnce());
    rejectRecovery({ code: "playground_reset_owner_unattested" });

    await expect(first).rejects.toEqual({ code: "playground_reset_owner_unattested" });
    await expect(second).rejects.toEqual({ code: "playground_reset_owner_unattested" });
    expect(createDesktopLocalProfile).not.toHaveBeenCalled();
    expect(activateDesktopLocalScope).not.toHaveBeenCalled();
    expect(readLocalProfile()).toBeNull();
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

  it("resets A before forgetting its playground identity and onboarding marker", async () => {
    vi.mocked(createDesktopLocalProfile).mockResolvedValue({ profileId: "opaque-profile-a" });
    await createAndActivateLocalProfile("Ada Locale");
    localStorage.setItem(
      "jht.desktop.onboarding.local:opaque-profile-a",
      "started-v1",
    );

    await resetPlaygroundLocalProfile();

    expect(resetDesktopPlaygroundLocalScope).toHaveBeenCalledWith("opaque-profile-a");
    expect(readLocalProfile()).toBeNull();
    expect(localIdentitySelected()).toBe(false);
    expect(localStorage.getItem("jht.desktop.onboarding.local:opaque-profile-a")).toBeNull();
  });

  it("preserves A renderer identity when the native reset fails closed", async () => {
    vi.mocked(createDesktopLocalProfile).mockResolvedValue({ profileId: "opaque-profile-a" });
    await createAndActivateLocalProfile("Ada Locale");
    vi.mocked(resetDesktopPlaygroundLocalScope).mockRejectedValue({
      code: "playground_reset_unavailable",
    });

    await expect(resetPlaygroundLocalProfile()).rejects.toEqual({
      code: "playground_reset_unavailable",
    });
    expect(readLocalProfile()).toEqual({
      profileId: "opaque-profile-a",
      displayName: "Ada Locale",
    });
    expect(localIdentitySelected()).toBe(true);
  });
});
