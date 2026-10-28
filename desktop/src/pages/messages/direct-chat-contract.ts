import type {
  DirectChatAnswerReceipt,
  DirectChatAttachment,
  DirectChatAttachState,
  DirectChatEvent,
  DirectChatPage,
  DirectChatReceipt,
  DirectChatStatus,
} from "../../lib/direct-chat";

export type {
  ChatKind,
  MessageKind,
  DirectChatAnswer,
  DirectChatAnswerReceipt,
  DirectChatAttachment,
  DirectChatAttachState,
  DirectChatEvent,
  DirectChatMessage,
  DirectChatPage,
  DirectChatQuestion,
  DirectChatQuestionOption,
  DirectChatReceipt,
  DirectChatStatus,
} from "../../lib/direct-chat";

type MaybePromise<T> = T | Promise<T>;

/** Structural boundary implemented by desktop/src/lib/direct-chat.ts. */
export type DirectChatClient = {
  subscribe(args: { onEvent: (event: DirectChatEvent) => void }): MaybePromise<DirectChatStatus>;
  status(): MaybePromise<DirectChatStatus>;
  reconnect(): Promise<DirectChatStatus>;
  read(args: { agentId: string; cursor?: string }): Promise<DirectChatPage>;
  send(args: {
    agentId: string;
    text: string;
    clientMessageId: string;
  }): Promise<DirectChatReceipt>;
  /** Enter once more on a text the agent's CLI did not take; absent on an older bridge. */
  enter?(args: { agentId: string; messageId: string }): Promise<DirectChatReceipt>;
  /** Absent on a client that cannot answer (an older bridge): the questions are then only shown. */
  answer?(args: {
    agentId: string;
    questionId: string;
    choices: string[];
    text: string | null;
  }): Promise<DirectChatAnswerReceipt>;
  /** The paperclip of the Assistant's chat. Absent on an older bridge: no button. */
  attachState?(): Promise<DirectChatAttachState>;
  attach?(args: { clientMessageId: string; locale: string }): Promise<DirectChatAttachment>;
  close(): MaybePromise<void>;
};
