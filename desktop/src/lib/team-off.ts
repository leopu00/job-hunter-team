import { createContext, useContext } from "react";

/**
 * The app is open WITHOUT the team: the person chose «open the app without starting the team», or the
 * team could not start (a provider limit) and the setup is left aside. The setup is NOT finished (its marker
 * stays «started»: the next launch offers the resume again); the pages that need the team say so.
 * The dashboard provides it only in that mode; null means the usual app.
 */
export interface TeamOff {
  teamOff: true;
  /**
   * Turns the runtime on again (the machine and the container), never the team: the native side puts the halt
   * gate down before the container boots, so that no agent starts; only the start of the team takes it away.
   * Resolves when it is up; rejects with the native error code when it cannot.
   */
  wakeRuntime(): Promise<void>;
  /**
   * Leaves the mode and goes back to the setup's «start the team» screen (today's flow). Absent where the mode
   * has no such step: the banner then offers only the wake.
   */
  startTeam?(): void;
}

export const TeamOffContext = createContext<TeamOff | null>(null);

export function useTeamOff(): TeamOff | null {
  return useContext(TeamOffContext);
}
