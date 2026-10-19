import type { PageProps } from "../types";
import DirectChatScreen, { isDirectChatAgentId } from "./DirectChatScreen";
import { directChatClient } from "./direct-chat-client";

/** The desktop Messages route talks only through the direct VPS bridge. */
export default function MessagesPage({ search }: PageProps) {
  const requestedAgent = search.get("agent");
  const initialAgentId = isDirectChatAgentId(requestedAgent) ? requestedAgent : "capitano";
  return <DirectChatScreen client={directChatClient} initialAgentId={initialAgentId} />;
}
