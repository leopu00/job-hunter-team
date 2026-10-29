import { readPanelList } from "./agent-control";
import type { TeamAgentsReading } from "./existing-team-agents";

/**
 * The agents of the team on THIS computer, in the shape the office draws an existing team's agents from
 * (lib/existing-team-agents.ts): the same read as the Agents page, which already asks the local team through
 * the native control. Nothing here reads the cloud, and nothing writes.
 */
export async function readThisComputerAgents(): Promise<TeamAgentsReading> {
  const list = await readPanelList();
  return list.ok ? { kind: "read", at: list.at, read: list.value } : { kind: "error", at: list.at, code: list.code };
}
