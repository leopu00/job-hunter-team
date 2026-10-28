import {
  activateDesktopLocalScope,
  createDesktopLocalProfile,
  recoverDesktopPlaygroundLocalOrphan,
  resetDesktopPlaygroundLocalScope,
} from "./desktop-account-scope";

const PROFILE_KEY_V1 = "jht.desktop.local-profile.v1";
const PROFILES_KEY = "jht.desktop.local-profiles.v2";
/** Where a list that could not be read is kept, the first time, before anything is written over it. */
const PROFILES_UNREADABLE_KEY = "jht.desktop.local-profiles.v2.unreadable";
const ACTIVE_KEY = "jht.desktop.identity.v1";
const ACTIVE_LOCAL = "local";
const ONBOARDING_PREFIX = "jht.desktop.onboarding.local:";
/** More than a person has on one computer; a list longer than this is not one this app wrote. */
const MAX_PROFILES = 50;
let playgroundCreation: Promise<LocalProfile> | null = null;

export interface LocalProfile {
  profileId: string;
  displayName: string;
}

export interface LocalProfileStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * What the renderer keeps of the local profiles of this computer (the backend holds each one's
 * capability in local-profiles/<id>.json). `activeId` is the one used last, kept when the identity
 * selection is cleared so the sign-in page can say who was here. `teamOwnerId` is a convenience copy
 * of who owns the team of this computer, set by `setTeamOwner`: the backend's marker is the truth, and
 * this is only what the pages say while they have not asked it. Deleting a profile and handing the team
 * to another one are `removeLocalProfile` and `setTeamOwner`.
 */
interface LocalProfilesV2 {
  version: 2;
  activeId: string | null;
  teamOwnerId: string | null;
  profiles: (LocalProfile & { createdAt: number })[];
}

function cleanName(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 80);
}

function validProfile(value: unknown): value is LocalProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.profileId === "string" && row.profileId.length > 0 &&
    typeof row.displayName === "string" && cleanName(row.displayName).length > 0;
}

function readV1(store: LocalProfileStore): LocalProfile | null {
  try {
    const raw = store.getItem(PROFILE_KEY_V1);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!validProfile(parsed)) return null;
    return { profileId: parsed.profileId, displayName: cleanName(parsed.displayName) };
  } catch {
    return null;
  }
}

function parseV2(raw: string): LocalProfilesV2 | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const row = parsed as Record<string, unknown>;
    if (row.version !== 2 || !Array.isArray(row.profiles) || row.profiles.length > MAX_PROFILES) return null;
    const seen = new Set<string>();
    const profiles: LocalProfilesV2["profiles"] = [];
    for (const entry of row.profiles) {
      if (!validProfile(entry) || seen.has(entry.profileId)) continue;
      seen.add(entry.profileId);
      const at = (entry as unknown as Record<string, unknown>).createdAt;
      profiles.push({
        profileId: entry.profileId,
        displayName: cleanName(entry.displayName),
        createdAt: typeof at === "number" && Number.isFinite(at) ? at : 0,
      });
    }
    const known = (id: unknown) => (typeof id === "string" && seen.has(id) ? id : null);
    return { version: 2, activeId: known(row.activeId), teamOwnerId: known(row.teamOwnerId), profiles };
  } catch {
    return null;
  }
}

function writeV2(state: LocalProfilesV2, store: LocalProfileStore): void {
  store.setItem(PROFILES_KEY, JSON.stringify(state));
  const raw = store.getItem(PROFILES_KEY);
  const saved = raw === null ? null : parseV2(raw);
  const same = saved !== null && saved.activeId === state.activeId && saved.teamOwnerId === state.teamOwnerId &&
    saved.profiles.length === state.profiles.length &&
    saved.profiles.every((entry, i) =>
      entry.profileId === state.profiles[i].profileId && entry.displayName === state.profiles[i].displayName);
  if (!same) throw new Error("local-profile-not-persisted");
}

/**
 * The saved profiles. A computer that has only the first version's single profile gets it as the
 * list's first entry, once: the old key stays as it is (an older build still reads it) and is never
 * read again.
 */
function loadState(store: LocalProfileStore): LocalProfilesV2 {
  let unreadable = false;
  try {
    const raw = store.getItem(PROFILES_KEY);
    const current = raw ? parseV2(raw) : null;
    if (current) return current;
    if (raw) {
      // a list that is there and cannot be read is not an empty one: it is kept as it is, once, for whoever
      // can recover it, and what follows (the first version's profile) is shown without writing over it
      unreadable = true;
      if (store.getItem(PROFILES_UNREADABLE_KEY) === null) store.setItem(PROFILES_UNREADABLE_KEY, raw);
    }
  } catch {
    // an unreadable store reads as no profiles
    return { version: 2, activeId: null, teamOwnerId: null, profiles: [] };
  }
  const old = readV1(store);
  const state: LocalProfilesV2 = { version: 2, activeId: null, teamOwnerId: null, profiles: [] };
  if (old) {
    state.profiles.push({ ...old, createdAt: 0 });
    state.activeId = old.profileId;
    if (!unreadable) {
      try { writeV2(state, store); } catch { /* read again next time */ }
    }
  }
  return state;
}

/** The list of saved local profiles, in the order they were made. */
export function listLocalProfiles(store: LocalProfileStore = localStorage): LocalProfile[] {
  return loadState(store).profiles.map(({ profileId, displayName }) => ({ profileId, displayName }));
}

/**
 * The profile the renderer believes owns the team of this computer; the backend's marker decides.
 * The copy that was set by hand wins. Without one, the owner is the profile that started its setup
 * first: the backend claims the team when a setup reaches the host, so a profile that started later
 * and was refused there did not take it. A profile that never started a setup owns nothing.
 */
export function readTeamOwnerCopy(store: LocalProfileStore = localStorage): LocalProfile | null {
  const state = loadState(store);
  const set = state.profiles.find((entry) => entry.profileId === state.teamOwnerId);
  const started = state.profiles.filter((entry) => {
    try { return store.getItem(`${ONBOARDING_PREFIX}${entry.profileId}`) !== null; } catch { return false; }
  });
  // the list is in the order the profiles were made
  const owner = set ?? started[0];
  return owner ? { profileId: owner.profileId, displayName: owner.displayName } : null;
}

/** The profile used last: the one the pages open as, once the local identity is selected. */
export function readLocalProfile(store: LocalProfileStore = localStorage): LocalProfile | null {
  const state = loadState(store);
  const active = state.profiles.find((entry) => entry.profileId === state.activeId);
  return active ? { profileId: active.profileId, displayName: active.displayName } : null;
}

/** Changes only the renderer-owned label of the profile in use; the native profile capability is immutable. */
export function renameLocalProfile(
  displayName: string,
  store: LocalProfileStore = localStorage,
): LocalProfile {
  const current = readLocalProfile(store);
  const name = cleanName(displayName);
  if (!current) throw new Error("local-profile-missing");
  if (!name) throw new Error("local-display-name-required");
  const state = loadState(store);
  const renamed = { ...current, displayName: name };
  saveLocalProfile(renamed, store, state);
  return renamed;
}

export function localIdentitySelected(store: LocalProfileStore = localStorage): boolean {
  try { return store.getItem(ACTIVE_KEY) === ACTIVE_LOCAL && readLocalProfile(store) !== null; }
  catch { return false; }
}

export function clearLocalIdentitySelection(store: LocalProfileStore = localStorage): void {
  store.removeItem(ACTIVE_KEY);
}

/**
 * Forgets one profile of the list and what the renderer keeps for it (its setup checkpoint). The
 * others stay. When it was the one in use the identity selection is cleared, and when it was the
 * owner's copy that is cleared too. The first version's key goes with it if it names the same profile,
 * so an older build does not bring it back. Deleting the profile's backend file or its team is not
 * done here.
 */
export function removeLocalProfile(profileId: string, store: LocalProfileStore = localStorage): void {
  const state = loadState(store);
  if (!state.profiles.some((entry) => entry.profileId === profileId)) throw new Error("local-profile-missing");
  const next: LocalProfilesV2 = {
    version: 2,
    activeId: state.activeId === profileId ? null : state.activeId,
    teamOwnerId: state.teamOwnerId === profileId ? null : state.teamOwnerId,
    profiles: state.profiles.filter((entry) => entry.profileId !== profileId),
  };
  if (state.activeId === profileId) store.removeItem(ACTIVE_KEY);
  writeV2(next, store);
  store.removeItem(`${ONBOARDING_PREFIX}${profileId}`);
  if (readV1(store)?.profileId === profileId) store.removeItem(PROFILE_KEY_V1);
  if (listLocalProfiles(store).some((entry) => entry.profileId === profileId)) {
    throw new Error("local-profile-not-cleared");
  }
}

/** Hands the renderer's copy of the team's owner to another saved profile (or to none). */
export function setTeamOwner(profileId: string | null, store: LocalProfileStore = localStorage): void {
  const state = loadState(store);
  if (profileId !== null && !state.profiles.some((entry) => entry.profileId === profileId)) {
    throw new Error("local-profile-missing");
  }
  if (state.teamOwnerId === profileId) return;
  writeV2({ ...state, teamOwnerId: profileId }, store);
}

/** Renderer cleanup is allowed only after the native committed receipt returned. */
export function finalizeLocalProfileMigration(
  profileId: string,
  store: LocalProfileStore = localStorage,
): void {
  const current = readLocalProfile(store);
  if (!current || current.profileId !== profileId) throw new Error("local-profile-changed");
  removeLocalProfile(profileId, store);
}

/** Adds the profile to the list, or renames it there, and makes it the one in use. Nothing else changes. */
function saveLocalProfile(profile: LocalProfile, store: LocalProfileStore, state = loadState(store)): void {
  const existing = state.profiles.find((entry) => entry.profileId === profile.profileId);
  if (!existing && state.profiles.length >= MAX_PROFILES) throw new Error("local-profile-list-full");
  const profiles = existing
    ? state.profiles.map((entry) => (entry.profileId === profile.profileId ? { ...entry, displayName: profile.displayName } : entry))
    : [...state.profiles, { profileId: profile.profileId, displayName: profile.displayName, createdAt: Date.now() }];
  try {
    writeV2({ ...state, activeId: profile.profileId, profiles }, store);
  } catch {
    throw new Error("local-profile-not-persisted");
  }
}

function selectLocalIdentity(store: LocalProfileStore): void {
  store.setItem(ACTIVE_KEY, ACTIVE_LOCAL);
  if (!localIdentitySelected(store)) throw new Error("local-identity-not-persisted");
}

export async function createAndActivateLocalProfile(
  displayName: string,
  store: LocalProfileStore = localStorage,
): Promise<LocalProfile> {
  const name = cleanName(displayName);
  if (!name) throw new Error("local-display-name-required");
  // before the backend makes one that the list could not hold
  if (loadState(store).profiles.length >= MAX_PROFILES) throw new Error("local-profile-list-full");
  const created = await createDesktopLocalProfile();
  if (!created || typeof created.profileId !== "string" || !created.profileId) {
    throw new Error("local-profile-invalid");
  }
  const profile = { profileId: created.profileId, displayName: name };
  saveLocalProfile(profile, store);
  await activateDesktopLocalScope(profile.profileId);
  selectLocalIdentity(store);
  return profile;
}

/** DEV playground creation boundary: recover an attested orphan before B exists. */
export function createAndActivatePlaygroundLocalProfile(
  displayName: string,
  store: LocalProfileStore = localStorage,
): Promise<LocalProfile> {
  if (playgroundCreation) return playgroundCreation;
  let current!: Promise<LocalProfile>;
  current = (async () => {
    try {
      await recoverDesktopPlaygroundLocalOrphan();
      return await createAndActivateLocalProfile(displayName, store);
    } finally {
      if (playgroundCreation === current) playgroundCreation = null;
    }
  })();
  playgroundCreation = current;
  return current;
}

export async function activateSavedLocalProfile(
  store: LocalProfileStore = localStorage,
): Promise<LocalProfile> {
  const profile = readLocalProfile(store);
  if (!profile) throw new Error("local-profile-missing");
  await activateDesktopLocalScope(profile.profileId);
  selectLocalIdentity(store);
  return profile;
}

/**
 * Chooses a saved profile before moving to the dashboard. The dashboard is the
 * single owner of the native scope activation once its page has loaded.
 */
export function selectSavedLocalProfile(
  store: LocalProfileStore = localStorage,
): LocalProfile {
  const profile = readLocalProfile(store);
  if (!profile) throw new Error("local-profile-missing");
  selectLocalIdentity(store);
  return profile;
}

/**
 * Chooses one of the saved profiles by its id, the others untouched: it becomes the one in use and
 * the local identity is selected. Like `selectSavedLocalProfile`, it opens no native scope.
 */
export function selectLocalProfileById(
  profileId: string,
  store: LocalProfileStore = localStorage,
): LocalProfile {
  const state = loadState(store);
  const chosen = state.profiles.find((entry) => entry.profileId === profileId);
  if (!chosen) throw new Error("local-profile-missing");
  if (state.activeId !== profileId) writeV2({ ...state, activeId: profileId }, store);
  selectLocalIdentity(store);
  return { profileId: chosen.profileId, displayName: chosen.displayName };
}

/**
 * Product entrypoint for the DEV onboarding playground reset. Native scope and
 * runtime ownership are released first; renderer identity/checkpoint data is
 * forgotten only after the backend confirms teardown.
 */
export async function resetPlaygroundLocalProfile(
  store: LocalProfileStore = localStorage,
): Promise<void> {
  const profile = readLocalProfile(store);
  if (!profile) throw new Error("local-profile-missing");
  await resetDesktopPlaygroundLocalScope(profile.profileId);
  removeLocalProfile(profile.profileId, store);
}
