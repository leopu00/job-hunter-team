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
  finalizeLocalProfileMigration,
  listLocalProfiles,
  localIdentitySelected,
  readLocalProfile,
  readTeamOwnerCopy,
  removeLocalProfile,
  renameLocalProfile,
  resetPlaygroundLocalProfile,
  selectLocalProfileById,
  selectSavedLocalProfile,
  setTeamOwner,
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
  it("renames only the local display label and keeps the profile capability stable", async () => {
    vi.mocked(createDesktopLocalProfile).mockResolvedValue({ profileId: "opaque-profile-a" });
    await createAndActivateLocalProfile("Ada Locale");

    expect(renameLocalProfile("  Bea   Locale ")).toEqual({ profileId: "opaque-profile-a", displayName: "Bea Locale" });
    expect(readLocalProfile()).toEqual({ profileId: "opaque-profile-a", displayName: "Bea Locale" });
    expect(activateDesktopLocalScope).toHaveBeenCalledTimes(1);
  });
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

  it("selects a saved profile without reopening its native scope", async () => {
    vi.mocked(createDesktopLocalProfile).mockResolvedValue({ profileId: "opaque-profile-a" });
    await createAndActivateLocalProfile("Ada Locale");
    clearLocalIdentitySelection();
    vi.clearAllMocks();

    expect(selectSavedLocalProfile()).toEqual({
      profileId: "opaque-profile-a",
      displayName: "Ada Locale",
    });
    expect(localIdentitySelected()).toBe(true);
    expect(activateDesktopLocalScope).not.toHaveBeenCalled();
  });

  it("forgets renderer-local profile state only after native migration committed", async () => {
    vi.mocked(createDesktopLocalProfile).mockResolvedValue({ profileId: "opaque-profile-a" });
    await createAndActivateLocalProfile("Synthetic Local");
    localStorage.setItem("jht.desktop.onboarding.local:opaque-profile-a", "subscription-v1");

    finalizeLocalProfileMigration("opaque-profile-a");

    expect(readLocalProfile()).toBeNull();
    expect(localIdentitySelected()).toBe(false);
    expect(localStorage.getItem("jht.desktop.onboarding.local:opaque-profile-a")).toBeNull();
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

const V1 = "jht.desktop.local-profile.v1";
const V2 = "jht.desktop.local-profiles.v2";
const ACTIVE = "jht.desktop.identity.v1";

async function make(profileId: string, name: string) {
  vi.mocked(createDesktopLocalProfile).mockResolvedValueOnce({ profileId });
  return createAndActivateLocalProfile(name);
}

describe("the list of local profiles", () => {
  it("adds a new profile to the saved ones and does not overwrite the first", async () => {
    await make("profile-a", "Ada");
    await make("profile-b", "Bea");

    expect(listLocalProfiles()).toEqual([
      { profileId: "profile-a", displayName: "Ada" },
      { profileId: "profile-b", displayName: "Bea" },
    ]);
    // the one used last is the new one; the first is still there
    expect(readLocalProfile()?.profileId).toBe("profile-b");
  });

  it("chooses a profile by its id, the others untouched, and opens no native scope", async () => {
    await make("profile-a", "Ada");
    await make("profile-b", "Bea");
    clearLocalIdentitySelection();
    vi.clearAllMocks();

    expect(selectLocalProfileById("profile-a")).toEqual({ profileId: "profile-a", displayName: "Ada" });
    expect(readLocalProfile()?.profileId).toBe("profile-a");
    expect(localIdentitySelected()).toBe(true);
    expect(listLocalProfiles()).toHaveLength(2);
    expect(activateDesktopLocalScope).not.toHaveBeenCalled();
    expect(() => selectLocalProfileById("nobody")).toThrow("local-profile-missing");
    expect(readLocalProfile()?.profileId).toBe("profile-a");
  });

  it("renames only the profile in use", async () => {
    await make("profile-a", "Ada");
    await make("profile-b", "Bea");
    renameLocalProfile("Beatrice");
    expect(listLocalProfiles().map((p) => p.displayName)).toEqual(["Ada", "Beatrice"]);
  });

  it("keeps the profile that was saved when its scope was refused, with the others", async () => {
    await make("profile-a", "Ada");
    vi.mocked(activateDesktopLocalScope).mockRejectedValueOnce({ code: "local_account_owner_mismatch" });
    vi.mocked(createDesktopLocalProfile).mockResolvedValueOnce({ profileId: "profile-b" });
    await expect(createAndActivateLocalProfile("Bea")).rejects.toEqual({ code: "local_account_owner_mismatch" });

    expect(listLocalProfiles().map((p) => p.profileId)).toEqual(["profile-a", "profile-b"]);
  });

  it("holds at most the profiles a person can have, and says it", async () => {
    for (let i = 0; i < 50; i += 1) await make(`profile-${i}`, `P${i}`);
    vi.mocked(createDesktopLocalProfile).mockResolvedValueOnce({ profileId: "profile-extra" });
    await expect(createAndActivateLocalProfile("Extra")).rejects.toThrow("local-profile-list-full");
    expect(listLocalProfiles()).toHaveLength(50);
  });
});

describe("the migration of the first version's profile", () => {
  it("makes the one profile the list and the profile in use, and leaves the old key as it was", () => {
    const old = JSON.stringify({ profileId: "old-profile", displayName: "  Ada   Vecchia " });
    localStorage.setItem(V1, old);
    localStorage.setItem(ACTIVE, "local");

    expect(listLocalProfiles()).toEqual([{ profileId: "old-profile", displayName: "Ada Vecchia" }]);
    expect(readLocalProfile()).toEqual({ profileId: "old-profile", displayName: "Ada Vecchia" });
    expect(localIdentitySelected()).toBe(true);
    expect(localStorage.getItem(V1)).toBe(old);
    expect(JSON.parse(localStorage.getItem(V2)!)).toMatchObject({ version: 2, activeId: "old-profile" });
  });

  it("takes the old profile for the team's owner only when its setup was started", () => {
    localStorage.setItem(V1, JSON.stringify({ profileId: "old-profile", displayName: "Ada" }));
    expect(readTeamOwnerCopy()).toBeNull();

    localStorage.clear();
    localStorage.setItem(V1, JSON.stringify({ profileId: "old-profile", displayName: "Ada" }));
    localStorage.setItem("jht.desktop.onboarding.local:old-profile", "started-v1");
    expect(readTeamOwnerCopy()).toEqual({ profileId: "old-profile", displayName: "Ada" });
  });

  it("keeps the old profile the owner once a new profile is added, which has not started a setup", async () => {
    localStorage.setItem(V1, JSON.stringify({ profileId: "old-profile", displayName: "Ada" }));
    localStorage.setItem("jht.desktop.onboarding.local:old-profile", "started-v1");
    await make("profile-new", "Bea");
    expect(listLocalProfiles().map((p) => p.profileId)).toEqual(["old-profile", "profile-new"]);
    expect(readTeamOwnerCopy()?.profileId).toBe("old-profile");
  });

  it("migrates once: a list emptied afterwards does not bring the old profile back", () => {
    localStorage.setItem(V1, JSON.stringify({ profileId: "old-profile", displayName: "Ada" }));
    expect(listLocalProfiles()).toHaveLength(1);
    removeLocalProfile("old-profile");
    expect(listLocalProfiles()).toEqual([]);
    expect(localStorage.getItem(V1)).toBeNull();
    // even if an older build wrote the key again, the list is the v2 one
    localStorage.setItem(V1, JSON.stringify({ profileId: "old-profile", displayName: "Ada" }));
    expect(listLocalProfiles()).toEqual([]);
  });

  it("reads an unreadable list as the first version's profile, and keeps the list as it was instead of writing over it", () => {
    localStorage.setItem(V1, JSON.stringify({ profileId: "old-profile", displayName: "Ada" }));
    localStorage.setItem(V2, "{not json");
    expect(listLocalProfiles()).toEqual([{ profileId: "old-profile", displayName: "Ada" }]);
    expect(localStorage.getItem(V2)).toBe("{not json");
    expect(localStorage.getItem(`${V2}.unreadable`)).toBe("{not json");

    // the copy is made once: a second unreadable list does not replace the first
    localStorage.setItem(V2, "{another");
    listLocalProfiles();
    expect(localStorage.getItem(`${V2}.unreadable`)).toBe("{not json");
  });

  it("keeps a whole list that cannot be read, with several profiles, for recovery", () => {
    const list = JSON.stringify({ version: 3, profiles: [{ profileId: "a" }, { profileId: "b" }] });
    localStorage.setItem(V2, list);
    expect(listLocalProfiles()).toEqual([]);
    expect(localStorage.getItem(V2)).toBe(list);
    expect(localStorage.getItem(`${V2}.unreadable`)).toBe(list);
  });

  it("has no profile on a computer that has never had one, and writes nothing", () => {
    expect(listLocalProfiles()).toEqual([]);
    expect(readLocalProfile()).toBeNull();
    expect(localStorage.getItem(V2)).toBeNull();
  });

  it("drops what a list says that is not true: a repeated id, a nameless entry, a pointer to nobody", () => {
    localStorage.setItem(V2, JSON.stringify({
      version: 2,
      activeId: "ghost",
      teamOwnerId: "ghost",
      profiles: [
        { profileId: "a", displayName: "Ada", createdAt: 1 },
        { profileId: "a", displayName: "Copia", createdAt: 2 },
        { profileId: "b", displayName: "   ", createdAt: 3 },
        { profileId: "", displayName: "Nessuno", createdAt: 4 },
      ],
    }));
    expect(listLocalProfiles()).toEqual([{ profileId: "a", displayName: "Ada" }]);
    expect(readLocalProfile()).toBeNull();
    expect(readTeamOwnerCopy()).toBeNull();
  });
});

describe("who owns the team of this computer, as the renderer remembers it", () => {
  const started = (id: string) => localStorage.setItem(`jht.desktop.onboarding.local:${id}`, "started-v1");

  it("is nobody while no profile has started a setup, and a scope the backend opens does not make one", async () => {
    await make("profile-a", "Ada");
    expect(readTeamOwnerCopy()).toBeNull();
    selectLocalProfileById("profile-a");
    await activateSavedLocalProfile();
    expect(readTeamOwnerCopy()).toBeNull();
  });

  it("is the profile that started its setup first, whoever started one after it", async () => {
    await make("profile-a", "Ada");
    await make("profile-b", "Bea");
    started("profile-b");
    expect(readTeamOwnerCopy()?.profileId).toBe("profile-b");
    started("profile-a");
    expect(readTeamOwnerCopy()?.profileId).toBe("profile-a");
  });

  it("is the profile it was handed to by hand, over the order of the setups, and none again when handed to none", async () => {
    await make("profile-a", "Ada");
    await make("profile-b", "Bea");
    started("profile-a");
    setTeamOwner("profile-b");
    expect(readTeamOwnerCopy()).toEqual({ profileId: "profile-b", displayName: "Bea" });
    setTeamOwner(null);
    expect(readTeamOwnerCopy()?.profileId).toBe("profile-a");
  });

  it("refuses to hand the copy to a profile that is not saved", async () => {
    await make("profile-a", "Ada");
    expect(() => setTeamOwner("nobody")).toThrow("local-profile-missing");
  });
});

describe("forgetting one profile", () => {
  it("removes it and its setup checkpoint, and leaves the others and what they own", async () => {
    await make("profile-a", "Ada");
    await make("profile-b", "Bea");
    localStorage.setItem("jht.desktop.onboarding.local:profile-a", "started-v1");
    localStorage.setItem("jht.desktop.onboarding.local:profile-b", "started-v1");
    setTeamOwner("profile-a");
    selectLocalProfileById("profile-b");

    removeLocalProfile("profile-b");

    expect(listLocalProfiles()).toEqual([{ profileId: "profile-a", displayName: "Ada" }]);
    expect(localStorage.getItem("jht.desktop.onboarding.local:profile-b")).toBeNull();
    expect(localStorage.getItem("jht.desktop.onboarding.local:profile-a")).toBe("started-v1");
    // the one in use was removed: nobody is in use and the identity is not selected
    expect(readLocalProfile()).toBeNull();
    expect(localIdentitySelected()).toBe(false);
    expect(readTeamOwnerCopy()?.profileId).toBe("profile-a");
  });

  it("forgets the owner's copy with the owner, and keeps the identity selection of another profile in use", async () => {
    await make("profile-a", "Ada");
    await make("profile-b", "Bea");
    setTeamOwner("profile-a");
    removeLocalProfile("profile-a");
    expect(readTeamOwnerCopy()).toBeNull();
    expect(readLocalProfile()?.profileId).toBe("profile-b");
    expect(localIdentitySelected()).toBe(true);
  });

  it("refuses a profile that is not in the list", () => {
    expect(() => removeLocalProfile("nobody")).toThrow("local-profile-missing");
  });

  it("finalizes a migration to the account for the profile in use only, the others staying", async () => {
    await make("profile-a", "Ada");
    await make("profile-b", "Bea");
    expect(() => finalizeLocalProfileMigration("profile-a")).toThrow("local-profile-changed");
    finalizeLocalProfileMigration("profile-b");
    expect(listLocalProfiles().map((p) => p.profileId)).toEqual(["profile-a"]);
    expect(localIdentitySelected()).toBe(false);
  });
});
