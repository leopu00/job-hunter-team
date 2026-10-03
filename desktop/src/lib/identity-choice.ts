const GOOGLE_CHOICE_KEY = "jht.desktop.google-choice.v1";

export interface IdentityChoiceStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * The Google choice survives only navigation between this window's entry and
 * dashboard pages. A fresh app process must ask again before touching the
 * encrypted Google session or its Keychain key.
 */
export function googleIdentitySelected(store: IdentityChoiceStore = sessionStorage): boolean {
  try { return store.getItem(GOOGLE_CHOICE_KEY) === "selected"; }
  catch { return false; }
}

export function selectGoogleIdentity(store: IdentityChoiceStore = sessionStorage): void {
  store.setItem(GOOGLE_CHOICE_KEY, "selected");
  if (!googleIdentitySelected(store)) throw new Error("google-identity-not-selected");
}

export function clearGoogleIdentitySelection(store: IdentityChoiceStore = sessionStorage): void {
  try { store.removeItem(GOOGLE_CHOICE_KEY); }
  catch { /* a closed store is already fail-closed */ }
}
