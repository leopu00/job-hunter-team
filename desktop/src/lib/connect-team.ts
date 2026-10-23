import { createContext, useContext } from "react";

/**
 * «Connect a team» for a profile that is set up but has no team linked (the gate is ready from the cloud,
 * with no saved connection): the same dialog as the setup's «Do you already have a team on a VPS?», opened
 * from inside the app. The dashboard provides it while the Shell shows no linked team.
 */
export interface ConnectTeamEntry {
  /** Opens the dialog, started from what this profile saved (team and host) if anything readable is saved. */
  open(): void;
  /** Asks the saved team to open again, read only; true when it opened. Nothing is started on the VPS. */
  reopen(): Promise<boolean>;
  /** The saved connection was removed (native «Unlink»): the read-only view of the team ends. */
  unlinked(): void;
}

export const ConnectTeamContext = createContext<ConnectTeamEntry | null>(null);

export function useConnectTeam(): ConnectTeamEntry | null {
  return useContext(ConnectTeamContext);
}
