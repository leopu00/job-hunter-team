import { createContext, useContext } from "react";

/**
 * How the person leaves the read-only view of an existing team (the way back to the setup, where
 * «Conferma e collega» opens the full connection). The Shell provides it while the view is on;
 * a page that has to point there (the chat, which cannot write in this view) asks for it here.
 */
export const LeaveReadOnlyContext = createContext<(() => void) | null>(null);

export function useLeaveReadOnly(): (() => void) | null {
  return useContext(LeaveReadOnlyContext);
}
