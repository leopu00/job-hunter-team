import type { TeamState } from "@/app/(protected)/team/MobileTeamStatus";
import { readPanelList, readTeamState } from "../../lib/agent-control";

/** How long the card waits for the native read of the team before it says the status is not available. */
export const LOCAL_TEAM_STATE_READ_MS = 10_000;

/**
 * The status card's row for the team of this computer, from what the agents' panel already reads of it (the
 * native agent_control: who is up, and whether the person stopped the team). The card was written for the cloud's
 * team_state; here «running» means an agent is up and the team is not stopped. The device heartbeat, the cloud's
 * last action, error and emergency-stop request do not exist on this computer: they are null, and the page leaves
 * the heartbeat line out (the time of a read would say «now» whatever the team did).
 * Null when the team cannot be read: the card then says it is not available.
 */
export async function localTeamState(): Promise<TeamState | null> {
  // a read that never answers must not leave the card on «checking» for ever: after this long it says «not available»
  let timer: ReturnType<typeof setTimeout> | undefined;
  const slow = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), LOCAL_TEAM_STATE_READ_MS);
  });
  const read = await Promise.race([Promise.all([readPanelList(), readTeamState()]), slow]).finally(() => clearTimeout(timer));
  if (read === null) return null;
  const [list, team] = read;
  if (!list.ok || !team.ok) return null;
  const anyoneUp = list.value.agents.some((agent) => agent.state.state !== "spento");
  return {
    should_run: !team.value.halted,
    is_running: anyoneUp && !team.value.halted,
    last_heartbeat_at: null,
    last_action: null,
    last_action_at: null,
    last_error: null,
    last_error_at: null,
    emergency_stop_requested_at: null,
    emergency_stop_completed_at: null,
  };
}
