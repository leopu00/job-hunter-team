import {
  answerDirectChat,
  attachDirectChat,
  directChatAttachState,
  closeDirectChat,
  enterDirectChat,
  directChatStatus,
  readDirectChat,
  reconnectDirectChat,
  sendDirectChat,
  subscribeDirectChat,
} from "../../lib/direct-chat";
import type { DirectChatClient } from "./direct-chat-contract";

/** The native direct chat, as the screens use it: the Messages page and the Chat tab of the Agents page. */
export const directChatClient: DirectChatClient = {
  subscribe: ({ onEvent }) => subscribeDirectChat(onEvent),
  status: directChatStatus,
  reconnect: reconnectDirectChat,
  read: ({ agentId, cursor }) => readDirectChat(agentId, cursor),
  send: ({ agentId, text, clientMessageId }) =>
    sendDirectChat(agentId, text, clientMessageId),
  answer: ({ agentId, questionId, choices, text }) => answerDirectChat(agentId, questionId, choices, text),
  enter: ({ agentId, messageId }) => enterDirectChat(agentId, messageId),
  attachState: () => directChatAttachState(),
  attach: ({ clientMessageId, locale }) => attachDirectChat(clientMessageId, locale),
  close: closeDirectChat,
};
