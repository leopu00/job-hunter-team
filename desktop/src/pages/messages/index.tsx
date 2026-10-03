import {
  closeDirectChat,
  directChatStatus,
  readDirectChat,
  reconnectDirectChat,
  sendDirectChat,
  subscribeDirectChat,
} from "../../lib/direct-chat";
import type { PageProps } from "../types";
import DirectChatScreen, { isDirectChatAgentId } from "./DirectChatScreen";
import type { DirectChatClient } from "./direct-chat-contract";

const directChatClient: DirectChatClient = {
  subscribe: ({ onEvent }) => subscribeDirectChat(onEvent),
  status: directChatStatus,
  reconnect: reconnectDirectChat,
  read: ({ agentId, cursor }) => readDirectChat(agentId, cursor),
  send: ({ agentId, text, clientMessageId }) =>
    sendDirectChat(agentId, text, clientMessageId),
  close: closeDirectChat,
};

/** The desktop Messages route talks only through the direct VPS bridge. */
export default function MessagesPage({ search }: PageProps) {
  const requestedAgent = search.get("agent");
  const initialAgentId = isDirectChatAgentId(requestedAgent) ? requestedAgent : "capitano";
  return <DirectChatScreen client={directChatClient} initialAgentId={initialAgentId} />;
}
