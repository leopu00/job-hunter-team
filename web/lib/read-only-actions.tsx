"use client";

import { createContext, useContext } from "react";

/**
 * A page shown read-only (the desktop on an existing team it only reads):
 * the buttons that would write stay on screen, disabled, and say why.
 * The web never provides it, so every control keeps working there.
 */
export type ReadOnlyActions = { readOnly: boolean; reason: string };

const NOT_READ_ONLY: ReadOnlyActions = { readOnly: false, reason: "" };

const ReadOnlyActionsContext = createContext<ReadOnlyActions>(NOT_READ_ONLY);

export const ReadOnlyActionsProvider = ReadOnlyActionsContext.Provider;

export function useReadOnlyActions(): ReadOnlyActions {
  return useContext(ReadOnlyActionsContext);
}
