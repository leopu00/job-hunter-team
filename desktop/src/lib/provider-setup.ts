import { createContext, useContext } from "react";

/**
 * The Settings page's way to the setup's «Provider» step for the team that already runs on this
 * computer (T128): the same step, with the same controls, opened again. The dashboard provides it
 * only while it shows the team of this computer (never the team on a VPS, which has its own
 * provider on its own host); the page asks for the card when it is there.
 */
export interface ProviderSetup {
  /** Reopens the setup at the «Provider» step; «Cancel» there brings the person back to the app. */
  open(): void;
}

export const ProviderSetupContext = createContext<ProviderSetup | null>(null);

export function useProviderSetup(): ProviderSetup | null {
  return useContext(ProviderSetupContext);
}
