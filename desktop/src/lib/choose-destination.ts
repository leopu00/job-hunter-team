import { createContext, useContext } from "react";

/**
 * How the person goes back to choosing where the team runs (the setup's host step), for a team whose saved
 * destination is gone or unreadable: asking the same question again would get the same refusal. The Shell
 * provides it when the dashboard can do it; a page that meets that refusal (the chat's bar) asks for it here.
 * The bar of the view of a team on a VPS (shell/VpsLinkBar.tsx) has its own way; this one is for the pages of
 * a profile on this computer, which that bar never covers.
 */
export const ChooseDestinationContext = createContext<(() => void) | null>(null);

export function useChooseDestination(): (() => void) | null {
  return useContext(ChooseDestinationContext);
}
