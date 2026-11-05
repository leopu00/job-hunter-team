"use client";

import { createContext, useContext } from "react";

/**
 * A page shown read-only (the desktop on an existing team it only reads):
 * the buttons that would write stay on screen, disabled, and say why.
 * The web never provides it, so every control keeps working there.
 */
export type ReadOnlyActions = {
  readOnly: boolean;
  reason: string;
  /**
   * The authorisation of an application is asked in two steps here even though the page is not the cloud's: the host
   * answers a preview (summary, destination, digest) and the person's click carries the digest and the destination back
   * (the desktop on the team of this computer).
   */
  applyTwoStep?: boolean;
  /**
   * The pages show what the team saved while it is off (the desktop on the team of this computer): what needs the team to
   * answer (a verdict on a card of the Swipe) stays on screen, disabled, with `reason`. Never set on the web.
   */
  teamOff?: boolean;
};

const NOT_READ_ONLY: ReadOnlyActions = { readOnly: false, reason: "" };

const ReadOnlyActionsContext = createContext<ReadOnlyActions>(NOT_READ_ONLY);

export const ReadOnlyActionsProvider = ReadOnlyActionsContext.Provider;

export function useReadOnlyActions(): ReadOnlyActions {
  return useContext(ReadOnlyActionsContext);
}
