import { readPanelList } from "../../lib/agent-control";
import type { ChatSession } from "./chat-agents";

/**
 * The sessions the team has up, for the list of conversations: the same read the Agents page makes (the list of the
 * team's tmux sessions), and nothing is written. A team that does not answer gives null, never an empty list: the
 * list of conversations then stays as it was.
 */
export async function loadChatSessions(read: typeof readPanelList = readPanelList): Promise<ChatSession[] | null> {
  const reply = await read();
  if (!reply.ok) return null;
  return reply.value.agents.map((agent) => ({ session: agent.name, up: agent.state.state !== "spento", state: agent.state }));
}
