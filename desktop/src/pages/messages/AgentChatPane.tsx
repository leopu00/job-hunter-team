import { useExistingTeamReadOnly } from "../../lib/existing-team-readonly";
import { useLeaveReadOnly } from "../../lib/leave-read-only";
import DirectChatScreen from "./DirectChatScreen";
import { directChatClient } from "./direct-chat-client";
import type { DirectChatClient } from "./direct-chat-contract";

/** The three agents the person talks to from the Agents page. */
export type AgentChatRole = "capitano" | "assistente" | "mentor";

/**
 * The chat with one agent, to be mounted as a tab: it reads, writes and follows the answers by
 * itself. In the read-only view of an existing team it shows the history and the replies and
 * says how to write; the refusal to write is the native side's, this only tells the person first.
 */
export function AgentChatPane({ role, client = directChatClient }: { role: AgentChatRole; client?: DirectChatClient }) {
  const readOnly = useExistingTeamReadOnly() !== null;
  const leaveReadOnly = useLeaveReadOnly();
  return (
    <DirectChatScreen
      client={client}
      initialAgentId={role}
      embedded
      writeLocked={readOnly}
      onConnect={readOnly && leaveReadOnly ? leaveReadOnly : undefined}
    />
  );
}

export default AgentChatPane;
