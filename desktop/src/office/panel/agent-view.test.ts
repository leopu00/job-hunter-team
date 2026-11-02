import { describe, expect, it } from "vitest";
import type { PanelList, TeamControlState } from "../../lib/agent-control";
import type { TeamAgent } from "../../lib/existing-team-agents";
import { agentView } from "./agent-view";

const agent = (name: string, role: string, state = "lavora"): TeamAgent => ({
  name,
  role,
  instance: null,
  created: null,
  activity: null,
  identity: null,
  state: { state: state as TeamAgent["state"]["state"] },
  usage: { contextPct: null, contextTokens: null, contextWindow: null, contextAt: null, tokensHour: null, tokensAt: null },
  questions: null,
});
const list = (agents: TeamAgent[]): PanelList => ({
  agents,
  roles: [{ role: "capitano", multi: false }, { role: "scout", multi: true }],
  statesKnown: true,
  target: "T",
  where: "local",
  label: null,
  ownVps: null,
});
const team = (held: TeamControlState["held"]): TeamControlState => ({
  halted: false,
  standby: { state: "off", until: null, weeklyReset: false },
  held,
  burnIntent: { state: "off", expiresAt: null, remainingMin: null },
});

describe("what the office's agent panel offers for one agent", () => {
  it("an agent that runs may be turned off, never restarted from here", () => {
    const view = agentView({ uid: "scout-1", role: "scout", list: list([agent("SCOUT-1", "scout")]), team: team([]), readOnly: false });
    expect(view).toMatchObject({ session: "SCOUT-1", listed: true, up: true, held: null, gestures: ["stop"] });
  });

  it("an agent turned off from the app is held by the user and may be turned on", () => {
    const view = agentView({ uid: "scout-1", role: "scout", list: list([agent("CAPITANO", "capitano")]), team: team([{ session: "SCOUT-1", byUser: true }]), readOnly: false });
    expect(view).toMatchObject({ listed: true, up: false, held: "user", gestures: ["start"] });
  });

  it("an agent the team put in safety may only be turned off, and says so", () => {
    const view = agentView({ uid: "scout-1", role: "scout", list: list([agent("CAPITANO", "capitano")]), team: team([{ session: "SCOUT-1", byUser: false }]), readOnly: false });
    expect(view.held).toBe("safety");
    expect(view.gestures).toEqual([]);
  });

  it("a session the team's list does not have is never offered to start", () => {
    const view = agentView({ uid: "scout-9", role: "scout", list: list([agent("CAPITANO", "capitano")]), team: team([]), readOnly: false });
    expect(view).toMatchObject({ session: "SCOUT-9", listed: false, gestures: [] });
  });

  it("offers nothing in the read-only view, nor before the list is read", () => {
    expect(agentView({ uid: "capitano", role: "capitano", list: list([agent("CAPITANO", "capitano")]), team: team([]), readOnly: true }).gestures).toEqual([]);
    expect(agentView({ uid: "capitano", role: "capitano", list: null, team: null, readOnly: false })).toMatchObject({ listed: false, gestures: [], held: null });
  });

  it("a listed agent whose state is off counts as not running", () => {
    expect(agentView({ uid: "capitano", role: "capitano", list: list([agent("CAPITANO", "capitano", "spento")]), team: team([]), readOnly: false }).up).toBe(false);
  });
});
