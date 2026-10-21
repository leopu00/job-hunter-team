"use client";

import { createContext, useContext } from "react";

/**
 * Who may write what commands the team or decides on the profile: the desktop app, not the
 * website (JHT-T24 exclusions, JHT-T46 standing orders). The website shows and says where to
 * decide; the desktop provides `canChange: true` outside the read-only view of an existing team.
 * Nothing provides it by default.
 */
export type DesktopWrite = { canChange: boolean };

const WEB: DesktopWrite = { canChange: false };

const DesktopWriteContext = createContext<DesktopWrite>(WEB);

export const DesktopWriteProvider = DesktopWriteContext.Provider;

export function useDesktopWrite(): DesktopWrite {
  return useContext(DesktopWriteContext);
}
