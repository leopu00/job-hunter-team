import { createContext, useContext } from "react";

/**
 * Settings' way back to the link of the local profile saved on this computer, offered only to an account that
 * went in without linking it («Sign in with Google without linking»): the page that asks to link it comes
 * again, as it does when the account signs in for the first time.
 */
export interface LocalProfileLink {
  /** Takes back the choice of leaving the profile unlinked and asks the link again. */
  link(): void;
}

export const LocalProfileLinkContext = createContext<LocalProfileLink | null>(null);

export function useLocalProfileLink(): LocalProfileLink | null {
  return useContext(LocalProfileLinkContext);
}
