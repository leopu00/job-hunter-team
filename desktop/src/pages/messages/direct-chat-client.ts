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
import { rememberChatPage } from "../../lib/chat-last-message";
import type { DirectChatClient } from "./direct-chat-contract";

/** The native direct chat, as the screens use it: the Messages page and the Chat tab of the Agents page. */
export const directChatClient: DirectChatClient = {
  // what the chat reads anyway also leaves the last message of each agent, for the office's panel (no read of its own)
  subscribe: ({ onEvent }) =>
    subscribeDirectChat((event) => {
      if (event.kind === "messages") rememberChatPage(event.agentId, event.page);
      onEvent(event);
    }),
  status: directChatStatus,
  reconnect: reconnectDirectChat,
  read: async ({ agentId, cursor }) => {
    const page = await readDirectChat(agentId, cursor);
    rememberChatPage(agentId, page);
    return page;
  },
  send: ({ agentId, text, clientMessageId }) =>
    sendDirectChat(agentId, text, clientMessageId),
  answer: ({ agentId, questionId, choices, text }) => answerDirectChat(agentId, questionId, choices, text),
  enter: ({ agentId, messageId }) => enterDirectChat(agentId, messageId),
  attachState: () => directChatAttachState(),
  attach: ({ clientMessageId, locale }) => attachDirectChat(clientMessageId, locale),
  close: closeDirectChat,
};
