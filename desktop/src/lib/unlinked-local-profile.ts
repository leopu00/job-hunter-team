/**
 * The person went in with their Google account without linking the local profile saved on this computer
 * («Sign in with Google without linking»): the choice is kept for that profile, so the page that offers the
 * link does not come back at every start. Settings has the way to link it later. Only the id of the profile
 * is kept, never the account: it is the profile that was left as it was.
 */
const KEY = "jht.desktop.unlinked-local-profile.v1";

export interface UnlinkedStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function store(): UnlinkedStore | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

/** Whether the person chose to leave this profile unlinked. An unreadable store says no: the page asks again. */
export function localProfileLeftUnlinked(profileId: string, from: UnlinkedStore | null = store()): boolean {
  try {
    const raw = from?.getItem(KEY);
    if (!raw) return false;
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && (parsed as { profileId?: unknown }).profileId === profileId;
  } catch {
    return false;
  }
}

/** Keeps the choice; false when it could not be kept (the page then asks again at the next start). */
export function leaveLocalProfileUnlinked(profileId: string, to: UnlinkedStore | null = store()): boolean {
  try {
    to?.setItem(KEY, JSON.stringify({ profileId }));
    return localProfileLeftUnlinked(profileId, to);
  } catch {
    return false;
  }
}

/** Takes the choice back: the next check offers the link again. */
export function forgetLocalProfileUnlinked(profileId: string, from: UnlinkedStore | null = store()): void {
  try {
    if (localProfileLeftUnlinked(profileId, from)) from?.removeItem(KEY);
  } catch {
    // an unreadable store keeps nothing to forget
  }
}
