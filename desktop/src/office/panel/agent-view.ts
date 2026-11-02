import type { PanelList, TeamControlState } from "../../lib/agent-control";
import { isUp, panelRows, rowActions, type PanelRow } from "../../pages/agents/AgentsPanel";

/**
 * What the office's agent panel shows of one agent, from what the Agents page already reads (its list and the
 * team's held sessions): the same rows and the same rule for what may be done to one, never another source.
 * Pure: no read here.
 */
export type AgentGesture = "start" | "stop";
/** Why an agent is off: «user» it was turned off from the app, «safety» the team put it in safety, null it is not held. */
export type AgentHeld = "user" | "safety" | null;

export type AgentView = {
  /** the agent's session as the team names it (the office's uid, upper case) */
  session: string;
  row: PanelRow;
  /** whether the team's list has the agent at all (a session it never listed is not offered to start) */
  listed: boolean;
  up: boolean;
  held: AgentHeld;
  /** what the person may do to it now: nothing in the read-only view, nothing while the list could not be read */
  gestures: AgentGesture[];
};

export function agentView(input: {
  uid: string;
  role: string;
  list: PanelList | null;
  team: TeamControlState | null;
  readOnly: boolean;
}): AgentView {
  const session = input.uid.toUpperCase();
  const found = input.list ? panelRows(input.list, input.team).find((row) => row.session === session) : undefined;
  const row: PanelRow = found ?? { session, role: input.role, agent: null, heldByUser: false, heldBySafety: false };
  const held: AgentHeld = row.heldBySafety ? "safety" : row.heldByUser ? "user" : null;
  // Spegni and Accendi only: the restart stays on the Agents page
  const gestures = found && !input.readOnly ? rowActions(found, false).filter((op): op is AgentGesture => op !== "restart") : [];
  return { session, row, listed: found !== undefined, up: isUp(row), held, gestures };
}
