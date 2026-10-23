import { createContext, useContext } from "react";
import type { ExistingTeamConnectionResult } from "./existing-team";

/**
 * The chat's way back to writing in the read-only view of an existing team: the same full connection
 * as the setup («Conferma e collega»), confirmed with one click from the chat, for the host and team
 * this profile saved. The dashboard provides it while the read-only view is on.
 */
export interface ReconfirmExistingTeam {
  /** The account the confirmation names (the same the setup shows); null when the app has none to show. */
  accountLabel: string | null;
  /** The full connection succeeded: the dashboard leaves the read-only view and opens the team in full. */
  onConnected(result: ExistingTeamConnectionResult): Promise<void>;
  /** What was saved does not match any more: back to the setup, where the modal asks again. */
  onSetup(): void;
}

export const ReconfirmExistingTeamContext = createContext<ReconfirmExistingTeam | null>(null);

export function useReconfirmExistingTeam(): ReconfirmExistingTeam | null {
  return useContext(ReconfirmExistingTeamContext);
}
