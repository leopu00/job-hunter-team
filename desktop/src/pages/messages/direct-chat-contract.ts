import type {
  DirectChatEvent,
  DirectChatPage,
  DirectChatReceipt,
  DirectChatStatus,
} from "../../lib/direct-chat";

export type {
  DirectChatEvent,
  DirectChatMessage,
  DirectChatPage,
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
  close(): MaybePromise<void>;
};
