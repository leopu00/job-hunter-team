import {
  activateDesktopLocalScope,
  createDesktopLocalProfile,
  resetDesktopPlaygroundLocalScope,
} from "./desktop-account-scope";

const PROFILE_KEY = "jht.desktop.local-profile.v1";
const ACTIVE_KEY = "jht.desktop.identity.v1";
const ACTIVE_LOCAL = "local";

export interface LocalProfile {
  profileId: string;
  displayName: string;
}

export interface LocalProfileStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
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

export function readLocalProfile(store: LocalProfileStore = localStorage): LocalProfile | null {
  try {
    const raw = store.getItem(PROFILE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!validProfile(parsed)) return null;
    return { profileId: parsed.profileId, displayName: cleanName(parsed.displayName) };
  } catch {
    return null;
  }
}

export function localIdentitySelected(store: LocalProfileStore = localStorage): boolean {
  try { return store.getItem(ACTIVE_KEY) === ACTIVE_LOCAL && readLocalProfile(store) !== null; }
  catch { return false; }
}

export function clearLocalIdentitySelection(store: LocalProfileStore = localStorage): void {
  store.removeItem(ACTIVE_KEY);
}

function clearLocalProfile(profileId: string, store: LocalProfileStore): void {
  const current = readLocalProfile(store);
  if (!current || current.profileId !== profileId) throw new Error("local-profile-changed");
  store.removeItem(ACTIVE_KEY);
  store.removeItem(PROFILE_KEY);
  store.removeItem(`jht.desktop.onboarding.local:${profileId}`);
  if (readLocalProfile(store) !== null) throw new Error("local-profile-not-cleared");
}

function saveLocalProfile(profile: LocalProfile, store: LocalProfileStore): void {
  store.setItem(PROFILE_KEY, JSON.stringify(profile));
  const saved = readLocalProfile(store);
  if (!saved || saved.profileId !== profile.profileId || saved.displayName !== profile.displayName) {
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
  clearLocalProfile(profile.profileId, store);
}
