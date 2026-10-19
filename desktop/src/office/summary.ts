import { AGENT_STATES, describeAgentState, type AgentState } from "@/lib/agent-state";
import { fill, officeText } from "./office.i18n";

/** One agent the team reports, for the line above the scene. */
export type SummaryAgent = {
  /** the session's name (SCOUT-2, closer-1) */
  name: string;
  /** what the team computes for it; null when the team does not say */
  state: AgentState | null;
  /** whether the office has a seat for it and draws it */
  drawn: boolean;
};

/** The order the counts are told in: work first, then who is stopped and why, then the rest. */
const ORDER: readonly AgentState[] = ["lavora", "bloccato", "aspetta_umano", "avviato_mai_partito", "idle", "spento", "sconosciuto"];

/**
 * The line above the scene that says at a glance how the team is: how many agents in each state
 * (the catalog's word and icon, in the person's language: "▶ working 7 · ⏸ blocked 2 · ✋
 * waiting for you 1"), and the agents the office has no seat for, which otherwise vanish in
 * silence. A state the team does not say is not counted; null when there is nothing to say.
 */
export function officeSummary(agents: SummaryAgent[], locale: string): string | null {
  const counts = new Map<AgentState, number>();
  for (const a of agents) if (a.state && a.state !== "sconosciuto") counts.set(a.state, (counts.get(a.state) ?? 0) + 1);
  const parts = ORDER.filter((s) => AGENT_STATES.includes(s) && counts.has(s)).map((s) => {
    const { icon, word } = describeAgentState({ state: s }, locale);
    return `${icon} ${word} ${counts.get(s)}`;
  });
  const out = agents.filter((a) => !a.drawn).map((a) => a.name.toUpperCase());
  const line = parts.join(" · ");
  const missing = out.length ? fill(officeText(locale).notInOffice, { names: out.join(", ") }) : "";
  return [line, missing].filter(Boolean).join(" — ") || null;
}
